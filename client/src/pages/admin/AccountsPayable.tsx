import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  DollarSign,
  Receipt,
  Loader2,
  Inbox,
  Ban,
  Trash2,
  Mail,
  UserPlus,
  Zap,
  Undo2,
  ExternalLink,
  RefreshCw,
  Link2,
  ChevronsUpDown,
  Check,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AddInvoiceModal from "@/components/AddInvoiceModal";
import { CashExpenseReview } from "@/components/CashExpenseReview";
import { useToast } from "@/hooks/use-toast";
import type { SupplierInvoice, Supplier, Store, EmailRoutingRule } from "@shared/schema";

type DocStatus = "ORIGINAL" | "STATEMENT_ONLY" | "NONE";
type EnrichedInvoice = SupplierInvoice & { supplier: Supplier | null; docStatus?: DocStatus | null; paidAt?: string | null };
// When it was marked paid: the payment record's timestamp; updatedAt only for PAID rows with no payment record.
const paidMoment = (inv: EnrichedInvoice) => inv.paidAt ?? (inv.updatedAt as unknown as string | null) ?? null;

// ── rawExtractedData shape from webhook ──────────────────────────────────────
interface ExtractedSupplierInfo {
  supplierName: string;
  supplierEmail?: string | null;
  senderEmail?: string;
  // Server field names (from parseInvoiceFromUnknownSender)
  supplierAddress?: string | null;
  supplierPhone?: string | null;
  abn?: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  // Legacy field names (kept for backward compat)
  address?: string | null;
  contactName?: string | null;
}
interface ReviewRawData {
  senderEmail: string;
  subject?: string;
  body?: string;
  supplier: ExtractedSupplierInfo;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  storeCode?: string;
  /** Set to true once the background AI parser has confirmed supplier identity.
   *  When absent/false on an invoice from an internal forwarder, the
   *  supplier.supplierName field may be a placeholder and should not be
   *  used as a grouping key or pre-filled supplier name. */
  _aiParsed?: boolean;
  /** True when the source document was a Statement of Account.
   *  If true AND there is only 1 extracted row, this invoice likely contains
   *  the grand total instead of an individual invoice — verify before approving. */
  _isStatement?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse From/Subject metadata stored in invoice notes field.
 *  Handles formats:
 *   "From: email\nSubject: text"
 *   "Forwarded by Name (email). Subject: text"
 *   "...From: email...Subject: text..."
 */
function parseNotesEmailInfo(notes: string | null | undefined): { from: string | null; subject: string | null } {
  if (!notes) return { from: null, subject: null };
  let from: string | null = null;
  let subject: string | null = null;

  // Line-by-line: "From: ..." and "Subject: ..."
  for (const line of notes.split("\n")) {
    const t = line.trim();
    if (!from && /^from:/i.test(t)) from = t.replace(/^from:/i, "").trim();
    else if (!subject && /^subject:/i.test(t)) subject = t.replace(/^subject:/i, "").trim();
  }

  // Inline: "Forwarded by Name (email@domain.com)."
  if (!from) {
    const m = notes.match(/\(([^)]+@[^)]+)\)/);
    if (m) from = m[1];
  }

  // Inline: "From: email@domain.com" anywhere in text (not just line-start)
  if (!from) {
    const m = notes.match(/\bFrom:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    if (m) from = m[1];
  }

  // Inline: "). Subject: text" or "Subject: text" anywhere
  if (!subject) {
    const m = notes.match(/[.;]\s*Subject:\s*(.+)/i) || notes.match(/Subject:\s*(.+)/i);
    if (m) subject = m[1].trim().split("\n")[0];
  }

  return { from, subject };
}

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Returns the invoice number for display. Hides auto-generated TRIAGE-/EMAIL- placeholders. */
function displayInvNumber(n: string | null | undefined): string {
  if (!n) return "—";
  if (/^(TRIAGE|EMAIL|PLACEHOLDER)-/i.test(n)) return "—";
  return n;
}

function fmtAUD(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

function fmtReceived(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "방금";
  if (diffMins < 60) return `${diffMins}분 전`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Returns "YYYY-MM-DD" of the Monday of the week containing dateStr (Mon–Sun).
// Parses YYYY-MM-DD directly to avoid UTC/timezone offset issues.
function getMondayStr(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(y, mo - 1, d); // local midnight — no timezone shift
  const dow = date.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysBack = (dow + 6) % 7;   // days to subtract to reach Monday
  date.setDate(d - daysBack);
  return date.toLocaleDateString("en-CA"); // "YYYY-MM-DD"
}

function isOverdue(dueDate: string | null | undefined, status: string): boolean {
  if (!dueDate) return false;
  if (status === "OVERDUE") return true;
  if (status !== "PENDING") return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function isDueSoon(dueDate: string | null | undefined, status: string): boolean {
  if (!dueDate || status !== "PENDING") return false;
  const diff = (new Date(dueDate).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= 7;
}

// ── Supplier group structure ──────────────────────────────────────────────────

interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  isAutoPay: boolean;
  invoices: EnrichedInvoice[];
  totalAmount: number;
  overdueAmount: number;
}

function groupBySupplier(invoices: EnrichedInvoice[]): SupplierGroup[] {
  const map = new Map<string, SupplierGroup>();
  invoices.forEach(inv => {
    const key = inv.supplierId ?? "unknown";
    if (!map.has(key)) {
      map.set(key, {
        supplierId: key,
        supplierName: inv.supplier?.name ?? "Unknown Supplier",
        isAutoPay: inv.supplier?.isAutoPay === true,
        invoices: [],
        totalAmount: 0,
        overdueAmount: 0,
      });
    }
    const g = map.get(key)!;
    g.invoices.push(inv);
    g.totalAmount += inv.amount ?? 0;
    if (isOverdue(inv.dueDate, inv.status)) {
      g.overdueAmount += inv.amount ?? 0;
    }
  });
  // Direct-debit (auto-pay) suppliers don't need manual action — they get
  // pushed to the bottom so the owner's eye lands on the manual-pay batch
  // first. Within each tier, sort by total amount descending so the biggest
  // exposure stays prominent.
  return Array.from(map.values()).sort((a, b) => {
    if (a.isAutoPay !== b.isAutoPay) return a.isAutoPay ? 1 : -1;
    return b.totalAmount - a.totalAmount;
  });
}

// ── Supplier hint extraction from rawExtractedData + notes fallback ──────────
//
// When a CEO forwards a supplier invoice, the system creates a REVIEW
// placeholder with rawExtractedData = { senderEmail, subject }.
// The supplier name is NOT in the PDF-parsed fields, so we derive it from:
//   1. rawExtractedData.supplier.supplierName  (AI-extracted — best)
//   2. subject string                          (strip [forwarder] prefix + inv# suffix)
//   3. senderEmail domain                      (e.g. greenstarfood.com.au → "Greenstarfood")
//   4. notes field                             (last-resort regex parse)
//
function extractSupplierHint(
  raw: ReviewRawData | null,
  notes: string | null
): { name: string; email: string; rawSenderEmail: string; abn: string } {
  // Internal forwarder check (used throughout this function)
  const isInternalForwarder = (email: string) =>
    !email || /@eatem\.com\.au$/i.test(email) || /^peterkang75@gmail\.com$/i.test(email);

  // ── 1. Sender email (computed first — needed to validate aiName trustworthiness) ──
  let senderEmail = raw?.senderEmail?.trim() ?? raw?.supplier?.senderEmail?.trim() ?? "";
  if (!senderEmail && notes) {
    const m = notes.match(/(?:^|\n)From:\s*([\w.+%-]+@[\w.-]+\.\w+)/i);
    if (m) senderEmail = m[1].trim();
  }
  const senderIsInternalFwdr = isInternalForwarder(senderEmail);

  // ── 2. AI-extracted supplier name ────────────────────────────────────────
  // TRUST RULES: The AI name is trustworthy when:
  //   a) The background AI parser confirmed it (_aiParsed: true), OR
  //   b) The sender is a real external supplier (not an internal forwarder).
  //
  // When an internal forwarder (e.g. peter.kang@eatem.com.au) routes emails,
  // the initial placeholder may have stored the forwarder's personal name
  // (e.g. "Peter Kang") as supplier.supplierName before AI parsing ran.
  // Without _aiParsed, we cannot trust that name — skip it and derive from
  // subject/domain instead so different suppliers are grouped correctly.
  const aiName = raw?.supplier?.supplierName?.trim() ?? "";
  const aiParsed = raw?._aiParsed === true;
  const aiNameTrusted = aiName && (aiParsed || !senderIsInternalFwdr);
  const effectiveAiName = aiNameTrusted ? aiName : "";

  // ── 3. ABN (from AI parse) ─────────────────────────────────────────────────
  const abn = (raw?.supplier as any)?.abn?.trim() ?? "";

  // ── 4. Subject string (clean up forwarding artefacts) ─────────────────────
  let subjectRaw = raw?.subject?.trim() ?? "";
  if (!subjectRaw && notes) {
    const m = notes.match(/(?:^|\n)Subject:\s*(.+)/i);
    if (m) subjectRaw = m[1].trim();
  }
  // Strip "[forwarder@email.com]" prefix added by Smart Forward Detector
  const subjectClean = subjectRaw
    .replace(/^\[[\w.@+%-]+\]\s*/i, "")           // remove [email@...] prefix
    .replace(/\s*inv[a-z]*\s*\d+\s*$/i, "")        // remove trailing "inv0365559"
    .replace(/\s*#?\d{4,}\s*$/, "")                // remove trailing bare numbers
    .trim();

  // ── 5. Domain-derived name (last resort — only for external senders) ──────
  let domainName = "";
  if (senderEmail && !senderIsInternalFwdr) {
    const domain = senderEmail.split("@")[1] ?? "";
    const base = domain.replace(/\.(com\.au|com|net\.au|net|org\.au|org|au)$/i, "");
    // "greenstarfood" → "Green Star Food"
    domainName = base
      .replace(/[._-]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  // Pick best name: trusted AI > clean subject (if plausible length) > domain
  const name = effectiveAiName || (subjectClean.length > 2 && subjectClean.length <= 60 ? subjectClean : "") || domainName;

  // ── 6. Contact email: use PDF-extracted supplier email ONLY if external ────
  const pdfEmail = raw?.supplier?.supplierEmail?.trim() ?? "";
  let contactEmail = "";
  if (pdfEmail && !isInternalForwarder(pdfEmail)) {
    contactEmail = pdfEmail;
  } else if (senderEmail && !senderIsInternalFwdr) {
    contactEmail = senderEmail;
  }
  // else: contactEmail stays "" — user must fill in manually

  return { name, email: contactEmail, rawSenderEmail: senderEmail, abn };
}

// ── Approve Supplier Modal (Group-based) ─────────────────────────────────────

interface ApproveSupplierModalProps {
  invoices: SupplierInvoice[];  // All invoices in the review group
  onClose: () => void;
  onSuccess: () => void;
}

interface SupplierFormValues {
  name: string;
  abn: string;
  contactName: string;
  contactEmails: string;
  bsb: string;
  accountNumber: string;
  address: string;
  notes: string;
}

type ApproveMode = "create" | "link";

function ApproveSupplierModal({ invoices, onClose, onSuccess }: ApproveSupplierModalProps) {
  const { toast } = useToast();
  const firstInvoice = invoices[0] ?? null;
  const raw = firstInvoice?.rawExtractedData as ReviewRawData | null;
  const [isAutoPay, setIsAutoPay] = useState(false);
  const [isMultiStore, setIsMultiStore] = useState(false);
  const [mode, setMode] = useState<ApproveMode>("create");
  const [linkedSupplierId, setLinkedSupplierId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Query all active suppliers for the link dropdown
  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    staleTime: 60_000,
  });

  const linkedSupplier = allSuppliers.find(s => s.id === linkedSupplierId) ?? null;

  function buildFormValues(r: ReviewRawData | null, notes: string | null) {
    const h = extractSupplierHint(r, notes);
    const s = r?.supplier;
    return {
      name: h.name,
      abn: s?.abn ?? "",
      contactName: s?.contactName ?? "",
      contactEmails: h.email,
      bsb: s?.bsb ?? "",
      accountNumber: s?.accountNumber ?? "",
      address: s?.supplierAddress ?? s?.address ?? "",
      notes: "",
    };
  }

  function buildFormFromSupplier(sup: Supplier): SupplierFormValues {
    return {
      name: sup.name,
      abn: sup.abn ?? "",
      contactName: sup.contactName ?? "",
      contactEmails: (sup.contactEmails ?? []).join(", "),
      bsb: sup.bsb ?? "",
      accountNumber: sup.accountNumber ?? "",
      address: sup.address ?? "",
      notes: "",
    };
  }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormValues>({
    defaultValues: buildFormValues(raw, firstInvoice?.notes ?? null),
  });

  useEffect(() => {
    if (firstInvoice) {
      const r = firstInvoice.rawExtractedData as ReviewRawData | null;
      reset(buildFormValues(r, firstInvoice.notes ?? null));
      setIsAutoPay(false);
      setIsMultiStore(false);
      setMode("create");
      setLinkedSupplierId(null);
    }
  }, [firstInvoice?.id, reset]);

  // When a supplier is selected in link mode, pre-fill the form with their data
  // But if their email is blank, pre-fill with the incoming sender email
  function handleLinkSupplier(sup: Supplier) {
    setLinkedSupplierId(sup.id);
    setPickerOpen(false);
    setIsAutoPay(sup.isAutoPay ?? false);
    setIsMultiStore(sup.isMultiStore ?? false);

    const formVals = buildFormFromSupplier(sup);
    // If supplier has no email yet, auto-populate with the incoming email hint
    if (!formVals.contactEmails) {
      const h = extractSupplierHint(raw, firstInvoice?.notes ?? null);
      formVals.contactEmails = h.email;
    }
    reset(formVals);
  }

  const approveMutation = useMutation({
    mutationFn: async (data: SupplierFormValues) => {
      if (!firstInvoice) throw new Error("No invoices in group");
      const r = firstInvoice.rawExtractedData as ReviewRawData | null;
      const h = extractSupplierHint(r, firstInvoice.notes ?? null);
      const senderEmail = h.rawSenderEmail;
      const supplierName = r?.supplier?.supplierName?.trim() || data.name;

      const emailsArray = data.contactEmails
        .split(",")
        .map(e => e.trim())
        .filter(Boolean);

      return apiRequest("POST", "/api/invoices/review/approve-group", {
        supplierData: {
          name: data.name,
          abn: data.abn || null,
          contactName: data.contactName || null,
          contactEmails: emailsArray.length > 0 ? emailsArray : null,
          bsb: data.bsb || null,
          accountNumber: data.accountNumber || null,
          address: data.address || null,
          notes: data.notes || null,
          isAutoPay,
          isMultiStore,
        },
        senderEmail: senderEmail || null,
        supplierName,
        reviewInvoiceIds: invoices.map(inv => inv.id),
        // Link mode: pass existingSupplierId to skip creation
        existingSupplierId: mode === "link" ? (linkedSupplierId ?? undefined) : undefined,
      }, { timeoutMs: 45_000 });
    },
    onSuccess: (result: any) => {
      const count = result?.sweptCount ?? invoices.length;
      const action = mode === "link" ? "기존 공급처에 연결했습니다" : "공급처를 만들었습니다";
      if (result?.allDuplicates) {
        toast({
          title: `${action}`,
          description: "이 명세서의 인보이스는 모두 이미 Crew에 있습니다. 이 검토 항목은 정리(보관)했습니다.",
        });
      } else {
        toast({ title: `${action} — 인보이스 ${count}건을 To Pay로 옮겼습니다` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-routing-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "공급처 승인에 실패했습니다", description: err?.message, variant: "destructive" });
    },
  });

  function onSubmit(data: SupplierFormValues) {
    if (mode === "link" && !linkedSupplierId) {
      toast({ title: "연결할 공급처를 선택하세요", variant: "destructive" });
      return;
    }
    approveMutation.mutate(data);
  }

  return (
    <Dialog open={invoices.length > 0} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-approve-supplier">
        <DialogHeader>
          <DialogTitle>인보이스 승인</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoices.length > 1 && (
              <span>이 보낸 사람의 인보이스 {invoices.length}건이 모두 To Pay로 옮겨집니다.</span>
            )}
          </p>
        </DialogHeader>

        {/* Statement-of-account warning */}
        {(raw as any)?._isStatement && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>명세서(Statement of Account)로 보입니다.</strong> 인보이스 한 건씩이 아니라 전체 합계만 들어 있을 수 있습니다.
              승인하기 전에 금액을 꼭 확인하세요 — 명세서 요약이 아니라 진짜 인보이스가 확실할 때만 승인하세요.
            </span>
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => { setMode("create"); setLinkedSupplierId(null); reset(buildFormValues(raw, firstInvoice?.notes ?? null)); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
              mode === "create"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover-elevate"
            }`}
            data-testid="button-mode-create"
          >
            <UserPlus className="h-3.5 w-3.5" />
            새 공급처 만들기
          </button>
          <button
            type="button"
            onClick={() => setMode("link")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
              mode === "link"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover-elevate"
            }`}
            data-testid="button-mode-link"
          >
            <Link2 className="h-3.5 w-3.5" />
            기존 공급처에 연결
          </button>
        </div>

        {/* Supplier search — shown only in link mode */}
        {mode === "link" && (
          <div className="space-y-1.5">
            <Label>기존 공급처 선택</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between"
                  data-testid="button-supplier-picker"
                >
                  {linkedSupplier ? linkedSupplier.name : "공급처 검색…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput placeholder="검색어 입력…" data-testid="input-supplier-search" />
                  <CommandList>
                    <CommandEmpty>찾는 공급처가 없습니다.</CommandEmpty>
                    <CommandGroup>
                      {allSuppliers
                        .filter(s => s.active !== false && s.name !== "Other / Unknown")
                        .map(s => (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => handleLinkSupplier(s)}
                            data-testid={`option-supplier-${s.id}`}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${linkedSupplierId === s.id ? "opacity-100" : "opacity-0"}`}
                            />
                            <span>{s.name}</span>
                            {(!s.contactEmails || s.contactEmails.length === 0) && (
                              <span className="ml-auto text-xs text-amber-600 font-medium">이메일 없음</span>
                            )}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {linkedSupplier && (!linkedSupplier.contactEmails || linkedSupplier.contactEmails.length === 0) && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                이 공급처는 등록된 이메일이 없습니다 — 이번에 들어온 이메일 주소가 자동으로 저장됩니다.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {mode === "create" && (
            <p className="text-xs text-muted-foreground">만들기 전에 AI가 읽어 온 공급처 정보를 확인하세요.</p>
          )}
          {mode === "link" && linkedSupplier && (
            <p className="text-xs text-muted-foreground">아래 칸에는 기존 공급처 정보가 들어 있습니다. 비어 있는 칸을 채우면 빠진 정보가 업데이트됩니다.</p>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sup-name">Supplier Name <span className="text-red-500">*</span></Label>
              <Input
                id="sup-name"
                {...register("name", { required: true })}
                placeholder="Supplier name"
                data-testid="input-supplier-name"
                readOnly={mode === "link" && !!linkedSupplierId}
                className={errors.name ? "border-red-500" : mode === "link" && !!linkedSupplierId ? "bg-muted/40" : ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-abn">ABN</Label>
                <Input id="sup-abn" {...register("abn")} placeholder="XX XXX XXX XXX" data-testid="input-supplier-abn" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-contact-name">Contact Name</Label>
                <Input id="sup-contact-name" {...register("contactName")} placeholder="Contact person" data-testid="input-supplier-contact-name" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-emails">Contact Emails</Label>
              <Input
                id="sup-emails"
                {...register("contactEmails")}
                placeholder="email@example.com, email2@example.com"
                data-testid="input-supplier-emails"
              />
              <p className="text-xs text-muted-foreground">여러 개는 쉼표로 구분하세요. 이 주소에서 오는 메일은 앞으로 자동으로 가져옵니다.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-bsb">BSB</Label>
                <Input id="sup-bsb" {...register("bsb")} placeholder="000-000" data-testid="input-supplier-bsb" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sup-account">Account Number</Label>
                <Input id="sup-account" {...register("accountNumber")} placeholder="XXXXXXXXX" data-testid="input-supplier-account" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-address">Address</Label>
              <Input id="sup-address" {...register("address")} placeholder="Street, Suburb, State" data-testid="input-supplier-address" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sup-notes">Notes</Label>
              <Input id="sup-notes" {...register("notes")} placeholder="Optional notes" data-testid="input-supplier-notes" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 mt-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <div>
                <Label htmlFor="approve-autopay" className="cursor-pointer font-medium">자동이체 (Auto-Pay)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">이 공급처는 자동이체로 빠져나갑니다 — 인보이스가 바로 지급 완료로 기록됩니다.</p>
              </div>
            </div>
            <Switch
              id="approve-autopay"
              checked={isAutoPay}
              onCheckedChange={setIsAutoPay}
              data-testid="switch-approve-autopay"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="multi-store" checked={isMultiStore} onCheckedChange={(v) => setIsMultiStore(v === true)} data-testid="checkbox-multi-store" />
            <Label htmlFor="multi-store" className="text-sm">여러 매장 공급처 (매장은 인보이스에 적힌 내용으로 정해집니다)</Label>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={approveMutation.isPending}>
              취소
            </Button>
            <Button
              type="submit"
              disabled={approveMutation.isPending || (mode === "link" && !linkedSupplierId)}
              data-testid="button-confirm-approve-supplier"
            >
              {approveMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{mode === "link" ? "연결 중…" : "만드는 중…"}</>
              ) : mode === "link" ? (
                <><Link2 className="h-3.5 w-3.5 mr-1.5" />공급처 연결 후 승인</>
              ) : (
                <><UserPlus className="h-3.5 w-3.5 mr-1.5" />공급처 만들고 승인</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reassign Supplier Dialog ──────────────────────────────────────────────────

interface ReassignSupplierDialogProps {
  invoice: EnrichedInvoice | null;
  onClose: () => void;
  onSuccess: () => void;
}

function ReassignSupplierDialog({ invoice, onClose, onSuccess }: ReassignSupplierDialogProps) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    staleTime: 60_000,
  });

  const selectedSupplier = allSuppliers.find(s => s.id === selectedSupplierId) ?? null;

  useEffect(() => {
    if (!invoice) setSelectedSupplierId(null);
  }, [invoice?.id]);

  const reassignMutation = useMutation({
    mutationFn: async () => {
      if (!invoice || !selectedSupplierId) throw new Error("Missing invoice or supplier");
      return apiRequest("PATCH", `/api/supplier-invoices/${invoice.id}/reassign`, {
        supplierId: selectedSupplierId,
      });
    },
    onSuccess: () => {
      toast({
        title: `인보이스를 ${selectedSupplier?.name ?? "공급처"}(으)로 옮겼습니다`,
      });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "공급처 변경에 실패했습니다", description: err?.message, variant: "destructive" });
    },
  });

  if (!invoice) return null;

  const currentSupplierName = invoice.supplier?.name ?? "Unknown Supplier";
  const invNum = invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : "이 인보이스";

  return (
    <Dialog open={!!invoice} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-reassign-supplier">
        <DialogHeader>
          <DialogTitle>공급처 변경</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invNum}을(를) <strong>{currentSupplierName}</strong>에서 올바른 공급처로 옮깁니다.
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>올바른 공급처 선택</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="button-reassign-supplier-picker"
                >
                  {selectedSupplier ? selectedSupplier.name : "공급처 검색…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput placeholder="검색어 입력…" data-testid="input-reassign-supplier-search" />
                  <CommandList>
                    <CommandEmpty>찾는 공급처가 없습니다.</CommandEmpty>
                    <CommandGroup>
                      {allSuppliers
                        .filter(s => s.active !== false && s.id !== invoice.supplierId && s.name !== "Other / Unknown")
                        .map(s => (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => { setSelectedSupplierId(s.id); setPickerOpen(false); }}
                            data-testid={`option-reassign-supplier-${s.id}`}
                          >
                            <Check className={`mr-2 h-4 w-4 ${selectedSupplierId === s.id ? "opacity-100" : "opacity-0"}`} />
                            {s.name}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedSupplier && (
            <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-sm space-y-0.5">
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-3.5 w-3.5 text-green-600" />
                {selectedSupplier.name}
              </div>
              {selectedSupplier.contactEmails && selectedSupplier.contactEmails.length > 0 && (
                <p className="text-xs text-muted-foreground pl-5">{selectedSupplier.contactEmails.join(", ")}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={reassignMutation.isPending}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!selectedSupplierId || reassignMutation.isPending}
            onClick={() => reassignMutation.mutate()}
            data-testid="button-confirm-reassign"
          >
            {reassignMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />옮기는 중…</>
              : <><Link2 className="h-3.5 w-3.5 mr-1.5" />옮기기</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type TabKey = "topay" | "review" | "history" | "statements" | "cashexpense" | "rejected" | "emailrules" | "quarantine" | "trash";

export function AdminAccountsPayable() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("topay");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const defaultFilterSet = useRef(false);
  // Persist selection across navigation — owner builds the pay batch over
  // multiple visits (review one invoice on a different page, come back,
  // tick another, etc.). localStorage keeps the picks alive across page
  // reloads too. Stale IDs (invoices since paid/deleted by someone else)
  // are pruned by an effect once /api/invoices loads below.
  const SELECTED_STORAGE_KEY = "ap_selected_invoices_v1";
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SELECTED_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr.filter(x => typeof x === "string")) : new Set();
    } catch {
      return new Set();
    }
  });
  const [expandedPayDates, setExpandedPayDates] = useState<Set<string>>(new Set());
  const [expandedHistorySuppliers, setExpandedHistorySuppliers] = useState<Set<string>>(new Set());
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [approveInvoiceGroup, setApproveInvoiceGroup] = useState<SupplierInvoice[]>([]);
  const [revertInvoice, setRevertInvoice] = useState<EnrichedInvoice | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [payConfirmOpen, setPayConfirmOpen] = useState(false);
  const [viewEmailInvoice, setViewEmailInvoice] = useState<SupplierInvoice | null>(null);
  const [reassignInvoice, setReassignInvoice] = useState<EnrichedInvoice | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: allInvoices = [], isLoading } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", "ALL"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    staleTime: 30_000,
  });

  // Mirror selection to localStorage on every change so a navigation away
  // (or accidental reload) brings the same picks back on return.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(Array.from(selected)));
    } catch {
      // localStorage full / disabled — selection still works in-memory.
    }
  }, [selected]);

  // Prune stale IDs once invoices load — keeps the persisted selection from
  // ghost-counting invoices that another admin already paid or deleted.
  // Runs only when allInvoices arrives so an empty initial render doesn't
  // wipe the saved picks before the data is in.
  useEffect(() => {
    if (allInvoices.length === 0) return;
    const valid = new Set(allInvoices.map(i => i.id));
    setSelected(prev => {
      let dirty = false;
      const next = new Set<string>();
      Array.from(prev).forEach(id => {
        if (valid.has(id)) next.add(id);
        else dirty = true;
      });
      return dirty ? next : prev;
    });
  }, [allInvoices]);

  const { data: reviewInvoices = [], isLoading: reviewLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/invoices/review"],
    staleTime: 30_000,
  });

  const { data: deletedInvoices = [], isLoading: trashLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/supplier-invoices/deleted"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: quarantinedInvoices = [], isLoading: quarantineLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/supplier-invoices/quarantined"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: rejectedEmails = [], isLoading: rejectedLoading } = useQuery<any[]>({
    queryKey: ["/api/rejected-emails", "unreviewed"],
    queryFn: () => fetch("/api/rejected-emails?reviewed=false").then(r => r.ok ? r.json() : []),
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: allSuppliersForPicker = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
    staleTime: 60_000,
  });

  const { data: emailRules = [], isLoading: rulesLoading } = useQuery<EmailRoutingRule[]>({
    queryKey: ["/api/email-routing-rules"],
    staleTime: 30_000,
  });

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  // ── Store filter ────────────────────────────────────────────────────────────
  // Holdings / PYC intentionally hidden from the filter bar — they hold no
  // supplier invoices today. Re-add the keyword here if that changes.
  const STORE_ORDER = ["sushi", "sandwich"];
  const filteredStores = useMemo(() => {
    const matched = STORE_ORDER.flatMap(keyword =>
      stores.filter(s => s.active && s.name.toLowerCase().includes(keyword))
    );
    const seen = new Set<string>();
    return matched.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  }, [stores]);

  useEffect(() => {
    if (!defaultFilterSet.current && filteredStores.length > 0) {
      defaultFilterSet.current = true;
      setStoreFilter(filteredStores[0].id);
    }
  }, [filteredStores]);

  const storeFiltered = useMemo(() => {
    if (!storeFilter || storeFilter === "ALL") return allInvoices;
    if (storeFilter === "UNASSIGNED") return allInvoices.filter(inv => !inv.storeId);
    // Only show invoices assigned to the selected store.
    // Unassigned (storeId=null) invoices are visible only in "All Stores" / "Unassigned".
    return allInvoices.filter(inv => inv.storeId === storeFilter);
  }, [allInvoices, storeFilter]);

  // Count of PENDING/OVERDUE invoices missing a storeId — shown as a badge
  // on the "Unassigned" filter chip so the manager can spot them quickly.
  const unassignedCount = useMemo(
    () => allInvoices.filter(inv => !inv.storeId && (inv.status === "PENDING" || inv.status === "OVERDUE")).length,
    [allInvoices]
  );

  const toPayInvoices = useMemo(
    () => storeFiltered.filter(inv => inv.status === "PENDING" || inv.status === "OVERDUE"),
    [storeFiltered]
  );
  const historyInvoices = useMemo(
    () =>
      storeFiltered
        .filter(inv => inv.status === "PAID")
        .sort((a, b) => {
          const da = paidMoment(a) ?? a.invoiceDate ?? "";
          const db = paidMoment(b) ?? b.invoiceDate ?? "";
          return db.localeCompare(da);
        }),
    [storeFiltered]
  );

  // Group paid invoices by payment date for the collapsible history view.
  // paidMoment is a UTC timestamp — convert to Sydney-local YYYY-MM-DD so a
  // payment made at 9am AEST May 15 (UTC May 14 23:00) groups under May 15,
  // not May 14. invoiceDate is a plain YYYY-MM-DD text column with no TZ, so
  // it's used as-is.
  const historyGrouped = useMemo(() => {
    const groups = new Map<string, typeof historyInvoices>();
    for (const inv of historyInvoices) {
      const payDate = paidMoment(inv)
        ? new Date(paidMoment(inv)!).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })
        : (inv.invoiceDate ?? "");
      if (!groups.has(payDate)) groups.set(payDate, []);
      groups.get(payDate)!.push(inv);
    }
    // Payment-date groups sorted DESCENDING (most recent pay date on top)
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [historyInvoices]);

  const togglePayDate = (dateKey: string) => {
    setExpandedPayDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

  const toggleHistorySupplier = (key: string) => {
    setExpandedHistorySuppliers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totalPayable = useMemo(() => toPayInvoices.reduce((s, inv) => s + (inv.amount ?? 0), 0), [toPayInvoices]);
  const totalOverdue = useMemo(
    () => toPayInvoices.filter(inv => isOverdue(inv.dueDate, inv.status)).reduce((s, inv) => s + (inv.amount ?? 0), 0),
    [toPayInvoices]
  );

  const supplierGroups = useMemo(() => groupBySupplier(toPayInvoices), [toPayInvoices]);

  // Count of unassigned (storeId=null) PENDING/OVERDUE invoices — only relevant when
  // viewing a specific store tab (not "All Stores").
  const unassignedToPayCount = useMemo(() => {
    if (!storeFilter || storeFilter === "ALL") return 0;
    return allInvoices.filter(
      inv => inv.storeId === null && (inv.status === "PENDING" || inv.status === "OVERDUE")
    ).length;
  }, [allInvoices, storeFilter]);

  const selectedTotal = useMemo(() => {
    return toPayInvoices
      .filter(inv => selected.has(inv.id))
      .reduce((s, inv) => s + (inv.amount ?? 0), 0);
  }, [toPayInvoices, selected]);

  // Pay / delete act on the picks visible in the current store tab only; picks made on another tab stay selected for later
  const visibleSelectedIds = useMemo(() => toPayInvoices.filter(inv => selected.has(inv.id)).map(inv => inv.id), [toPayInvoices, selected]);
  const hiddenSelectedCount = selected.size - visibleSelectedIds.length;
  const dropFromSelection = (ids: string[]) => setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });

  const selectedBySupplier = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    toPayInvoices
      .filter(inv => selected.has(inv.id))
      .forEach(inv => {
        const sid = inv.supplierId ?? "unknown";
        const name = inv.supplier?.name ?? "Unknown Supplier";
        const existing = map.get(sid);
        if (existing) {
          existing.total += inv.amount ?? 0;
        } else {
          map.set(sid, { name, total: inv.amount ?? 0 });
        }
      });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [toPayInvoices, selected]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/invoices/${id}/status`, { status: "PAID" })));
    },
    onSuccess: (_data, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      dropFromSelection(ids);
      toast({ title: `인보이스 ${ids.length}건을 지급 완료로 표시했습니다` });
    },
    onError: () => toast({ title: "인보이스 업데이트에 실패했습니다", variant: "destructive" }),
  });

  const revertMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("POST", `/api/invoices/${invoiceId}/revert`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "인보이스를 To Pay로 되돌렸습니다" });
      setRevertInvoice(null);
    },
    onError: () => {
      toast({ title: "되돌리기에 실패했습니다", variant: "destructive" });
      setRevertInvoice(null);
    },
  });

  const ignoreSenderMutation = useMutation({
    mutationFn: async ({ invoiceIds, senderEmail, supplierName }: { invoiceIds: string[]; senderEmail: string; supplierName?: string }) => {
      const ops: Promise<any>[] = [
        ...(senderEmail ? [apiRequest("PUT", `/api/email-routing-rules/${encodeURIComponent(senderEmail)}`, {
          action: "SPAM_DROP",
          supplierName: supplierName ?? null,
        })] : []),
        ...invoiceIds.map(id =>
          apiRequest("PUT", `/api/supplier-invoices/${id}`, {
            status: "QUARANTINE",
            notes: `Supplier ignored by manager. Email: ${senderEmail}`,
          })
        ),
      ];
      await Promise.all(ops);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-routing-rules"] });
      toast({ title: "공급처를 무시하도록 설정했습니다", description: "이 공급처에서 온 대기 중인 인보이스를 모두 치웠습니다." });
    },
    onError: () => toast({ title: "공급처 무시 설정에 실패했습니다", variant: "destructive" }),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/supplier-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      toast({ title: "인보이스를 삭제했습니다", description: "인보이스가 지워졌습니다." });
    },
    onError: () => toast({ title: "인보이스 삭제에 실패했습니다", variant: "destructive" }),
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/supplier-invoices/${id}/soft-delete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: "인보이스를 휴지통으로 옮겼습니다", description: "Trash 탭(휴지통)에서 되살릴 수 있습니다." });
    },
    onError: () => toast({ title: "인보이스 삭제에 실패했습니다", variant: "destructive" }),
  });

  const bulkSoftDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/supplier-invoices/${id}/soft-delete`)));
    },
    onSuccess: (_data, ids) => {
      const n = ids.length;
      dropFromSelection(ids);
      setBulkDeleteConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: `인보이스 ${n}건을 휴지통으로 옮겼습니다`, description: "필요하면 Trash 탭(휴지통)에서 되살리세요." });
    },
    onError: () => {
      toast({ title: "인보이스 삭제에 실패했습니다", variant: "destructive" });
      setBulkDeleteConfirmOpen(false);
    },
  });

  const restoreInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/supplier-invoices/${id}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: "인보이스를 되살렸습니다", description: "원래 자리로 돌아갔습니다." });
    },
    onError: () => toast({ title: "되살리기에 실패했습니다", variant: "destructive" }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/supplier-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: "영구 삭제했습니다", description: "인보이스가 완전히 지워졌습니다." });
    },
    onError: () => toast({ title: "영구 삭제에 실패했습니다", variant: "destructive" }),
  });

  // Open the stored invoice PDF in a new tab. window.open() can't carry the
  // admin Bearer token, so the route's auth middleware 401s the bare
  // navigation. Instead fetch with auth (the patched fetch wrapper injects
  // the token), wrap the response as an object URL, and open that. Cleans
  // the blob URL after a short delay so memory doesn't pile up.
  const openInvoicePdf = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/supplier-invoices/${invoiceId}/pdf`);
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        toast({ title: "PDF를 열 수 없습니다", description: msg.slice(0, 200) || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast({ title: "PDF를 열 수 없습니다", description: e?.message ?? "네트워크 오류", variant: "destructive" });
    }
  };

  const deleteRuleMutation = useMutation({
    mutationFn: async (email: string) => {
      await apiRequest("DELETE", `/api/email-routing-rules/${encodeURIComponent(email)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-routing-rules"] });
      toast({ title: "메일 규칙을 삭제했습니다", description: "앞으로 이 주소에서 오는 메일은 모르는 보낸 사람으로 처리됩니다." });
    },
    onError: () => toast({ title: "규칙 삭제에 실패했습니다", variant: "destructive" }),
  });

  const reparsePdfMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      return apiRequest("POST", `/api/supplier-invoices/${invoiceId}/reparse-pdf`);
    },
    onSuccess: async (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/to-pay"] });
      const body = await res.json().catch(() => ({}));
      let description: string;
      if (body?.duplicateOfExisting) {
        description = `이미 있는 인보이스입니다: #${body.invoiceNumber}. 중복이라 이 줄은 지웠습니다.`;
      } else if (body?.needsSupplierAssignment) {
        description = `인보이스 ${body.invoiceCount}건이 담긴 명세서입니다. 먼저 공급처를 직접 지정하세요 — 그다음 다시 읽기를 하면 To Pay로 펼쳐집니다.`;
      } else if (body?.isStatement) {
        description = `명세서를 펼쳤습니다 → To Pay에 새 인보이스 ${body.expanded}건, 중복 ${body.skippedDupes}건은 건너뜀.`;
      } else {
        description = `인보이스 ${body?.invoiceCount ?? 0}건을 읽었습니다${body?.parserUsed ? ` (${body.parserUsed})` : ""}. 승인하면 To Pay로 갑니다.`;
      }
      toast({ title: "PDF를 다시 읽었습니다", description });
    },
    onError: (err: any) => {
      // err.message is like '422: {"error":"AI parser returned no invoice items..."}'
      const msg = String(err?.message ?? "");
      const m = msg.match(/^\d+:\s*(.+)$/);
      let detail = m ? m[1] : msg;
      try {
        const parsed = JSON.parse(detail);
        if (parsed?.error) detail = parsed.error;
      } catch { /* keep raw */ }
      toast({
        title: "다시 읽기에 실패했습니다",
        description: detail || "저장된 PDF에서 내용을 다시 읽지 못했습니다.",
        variant: "destructive",
      });
    },
  });

  // ── Selection helpers ───────────────────────────────────────────────────────
  function toggleOne(id: string) {
    // Prevent selection of auto-pay invoices
    const inv = toPayInvoices.find(i => i.id === id);
    if (inv?.supplier?.isAutoPay === true) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Shift+click range selection ────────────────────────────────────────────
  // Standard spreadsheet/Gmail UX: click one checkbox, then Shift+click another
  // within the same supplier group to apply the SAME action to every row
  // between them (inclusive). The action is decided by the target row's
  // current state at click time:
  //   • target currently UNSELECTED → Shift+click ADDS the whole range
  //   • target currently SELECTED   → Shift+click REMOVES the whole range
  // This makes range-deselect work symmetrically to range-select.
  const shiftKeyPressedRef = useRef(false);
  const lastCheckboxRef = useRef<{ supplierId: string; invoiceId: string } | null>(null);

  function handleRowCheckbox(invId: string, group: SupplierGroup) {
    const shiftHeld = shiftKeyPressedRef.current;
    shiftKeyPressedRef.current = false;

    if (shiftHeld && lastCheckboxRef.current?.supplierId === group.supplierId) {
      const sortedInGroup = [...group.invoices].sort(
        (a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "")
      );
      const prevId = lastCheckboxRef.current.invoiceId;
      const idxPrev = sortedInGroup.findIndex(i => i.id === prevId);
      const idxCurr = sortedInGroup.findIndex(i => i.id === invId);
      if (idxPrev !== -1 && idxCurr !== -1) {
        const [from, to] = idxPrev < idxCurr ? [idxPrev, idxCurr] : [idxCurr, idxPrev];
        const rangeIds = sortedInGroup
          .slice(from, to + 1)
          .filter(i => i.supplier?.isAutoPay !== true)
          .map(i => i.id);
        // If the target row is already selected, treat the range action as
        // DESELECT. Otherwise treat it as SELECT.
        const shouldSelect = !selected.has(invId);
        setSelected(prev => {
          const next = new Set(prev);
          if (shouldSelect) rangeIds.forEach(id => next.add(id));
          else rangeIds.forEach(id => next.delete(id));
          return next;
        });
        lastCheckboxRef.current = { supplierId: group.supplierId, invoiceId: invId };
        return;
      }
    }

    toggleOne(invId);
    lastCheckboxRef.current = { supplierId: group.supplierId, invoiceId: invId };
  }

  function toggleSupplier(group: SupplierGroup) {
    // Auto-Pay suppliers: no invoices can be selected
    if (group.isAutoPay) return;
    const ids = group.invoices
      .filter(i => i.supplier?.isAutoPay !== true)
      .map(i => i.id);
    const allSel = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSel) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Supplier accordions start COLLAPSED by default. Manager expands each one
  // only when they want to work on it — keeps the overview scannable.
  // (Previously: auto-opened every group on first load.)

  // ── Group review invoices by AI-extracted supplier identity ──────────────────
  // GROUPING STRATEGY: Group by the best available unique supplier identifier.
  // Priority: ABN (globally unique) > AI-extracted name > subject-derived name.
  //
  // CRITICAL: NEVER group by senderEmail when the sender is an internal forwarder
  // (e.g. peter.kang@eatem.com.au). A single forwarder may route invoices from
  // multiple different suppliers — grouping by their email merges unrelated suppliers.
  interface ReviewGroup {
    supplierName: string;
    abn: string;               // AI-extracted ABN (empty if not found)
    invoices: SupplierInvoice[];
    totalAmount: number;
    senderEmail: string;       // PDF-extracted supplier email (or blank if internal forwarder)
    rawSenderEmail: string;    // Actual From: address — used for email routing rules
    rawFirst: ReviewRawData | null;
  }
  // Includes inactive suppliers too — Backfill might link a row to a
  // deactivated vendor (e.g., dormant supplier still registered with the
  // whitelisted email). Without this the display would fall back to the
  // AI-extracted buyer mislabel even after a successful link.
  const { data: allSuppliersIncludingInactive = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", "all"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers?includeInactive=1");
      if (!res.ok) throw new Error("Failed to fetch suppliers (incl. inactive)");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Map supplier id → registered supplier name so REVIEW rows that already
  // got their supplier_id linked (e.g., by Backfill) display under the real
  // supplier instead of the AI-extracted buyer/trading-name mislabel.
  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSuppliersIncludingInactive as Array<{ id: string; name: string }>) m.set(s.id, s.name);
    return m;
  }, [allSuppliersIncludingInactive]);

  const reviewGroups = useMemo<ReviewGroup[]>(() => {
    const map = new Map<string, ReviewGroup>();
    for (const inv of reviewInvoices) {
      const r = inv.rawExtractedData as ReviewRawData | null;
      // Linked supplier (set by Backfill or webhook) wins; otherwise fall back
      // to AI-extracted hint. This keeps groups labelled by the registered
      // vendor name when the row is correctly linked, even if AI mislabelled.
      const linkedName = inv.supplierId ? supplierNameById.get(inv.supplierId) ?? null : null;
      const hint = extractSupplierHint(r, inv.notes ?? null);
      const name = linkedName || hint.name || "Unknown Supplier";
      const abn = hint.abn;
      const senderEmail = hint.email;
      const rawSenderEmail = hint.rawSenderEmail;

      // Grouping key: prefer linked supplier id (the real, deduped key once a
      // row is attached), then ABN, then name. Falls back to invoice id for
      // truly unknown rows.
      const groupKey =
        inv.supplierId
          ? `supplier:${inv.supplierId}`
          : abn
            ? `abn:${abn}`
            : (name !== "Unknown Supplier" ? `name:${name}` : `id:${inv.id}`);

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          supplierName: name,
          abn,
          invoices: [],
          totalAmount: 0,
          senderEmail,
          rawSenderEmail,
          rawFirst: r,
        });
      }
      const g = map.get(groupKey)!;
      g.invoices.push(inv);
      g.totalAmount += r?.totalAmount ?? 0;
      // Prefer better-quality data from whichever invoice has it
      if (!g.senderEmail && senderEmail) g.senderEmail = senderEmail;
      if (!g.rawSenderEmail && rawSenderEmail) g.rawSenderEmail = rawSenderEmail;
      // If a later invoice in the same group has a more specific name, prefer it
      if (g.supplierName === "Unknown Supplier" && name !== "Unknown Supplier") g.supplierName = name;
      if (!g.abn && abn) g.abn = abn;
    }
    return Array.from(map.values());
  }, [reviewInvoices]);

  // ── Tab config ──────────────────────────────────────────────────────────────
  const tabs: { key: TabKey; label: string; badge?: number; badgeColor?: string }[] = [
    {
      key: "topay",
      label: "To Pay",
      badge: toPayInvoices.length > 0 ? toPayInvoices.length : undefined,
      badgeColor: totalOverdue > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    },
    {
      key: "review",
      label: "Review Inbox",
      badge: reviewInvoices.length > 0 ? reviewInvoices.length : undefined,
      badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    },
    {
      key: "history",
      label: "Paid History",
      badge: historyInvoices.length > 0 ? historyInvoices.length : undefined,
      badgeColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
    },
    {
      key: "statements",
      label: "Statements",
      badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      key: "cashexpense",
      label: "Cash Expenses",
      badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      key: "emailrules",
      label: "Email Rules",
      badge: emailRules.length > 0 ? emailRules.length : undefined,
      badgeColor: "bg-muted text-muted-foreground",
    },
    {
      key: "rejected",
      label: "Rejected",
      badge: rejectedEmails.length > 0 ? rejectedEmails.length : undefined,
      badgeColor: "bg-destructive/10 text-destructive",
    },
    {
      key: "quarantine",
      label: "Quarantine",
      badge: quarantinedInvoices.length > 0 ? quarantinedInvoices.length : undefined,
      badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    },
    {
      key: "trash",
      label: "Trash",
      badge: deletedInvoices.length > 0 ? deletedInvoices.length : undefined,
      badgeColor: "bg-muted text-muted-foreground",
    },
  ];

  const showStoreFilter = activeTab === "topay" || activeTab === "history" || activeTab === "cashexpense";
  return (
    <AdminLayout title="Accounts Payable">
      <div className="flex flex-col gap-5">

        {/* ── Sticky header: summary cards + tab bar ─────────────────────────
            Owner request: Total Payable + Selected Total stay visible across
            every tab (even Review Inbox / Paid History) and pin to the top
            when the page scrolls so the running pay batch is always in
            sight. The store filter row + Add Invoice sit just below this and
            scroll normally with the content. */}
        {/* Background must be FULLY opaque. It was bg-muted/30, which let the
            invoice rows scroll visibly through the tab strip. bg-background is
            #fff over the page's own muted/30 (#fafafa) — a difference you can't
            see — so the bar reads as part of the page until content slides
            under it, where the border + shadow draw the edge. The negative
            margins bleed it into the page gutters so nothing shows at the
            sides. */}
        <div className="sticky top-0 z-20 bg-background border-b border-border shadow-sm pt-1 -mt-1 pb-2 -mx-3 px-3 sm:-mx-6 sm:px-6 space-y-3 sm:space-y-4">

          {/* Summary cards — always rendered */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <Card>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5 sm:mb-1">Total Payable</p>
                    <p className="text-lg sm:text-2xl font-bold tracking-tight tabular-nums truncate" data-testid="text-total-payable">
                      {fmtAUD(totalPayable)}
                    </p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{toPayInvoices.length} pending invoices</p>
                  </div>
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                {totalOverdue > 0 && (
                  <p className="text-[10px] sm:text-xs text-red-600 dark:text-red-400 font-semibold mt-1.5 sm:mt-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate">Overdue: {fmtAUD(totalOverdue)}</span>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={selected.size > 0 ? "border-primary/40" : ""}>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] sm:text-xs text-muted-foreground mb-0.5 sm:mb-1">Selected Total</p>
                    <p className={`text-lg sm:text-2xl font-bold tracking-tight tabular-nums truncate transition-colors ${selected.size > 0 ? "text-primary" : "text-muted-foreground/50"}`} data-testid="text-selected-total-card">
                      {fmtAUD(selectedTotal)}
                    </p>
                    {selected.size > 0 ? (
                      <div className="mt-1.5 space-y-0.5">
                        {selectedBySupplier.map(s => (
                          <div key={s.name} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground truncate">{s.name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="tabular-nums text-foreground/70">{fmtAUD(s.total)}</span>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await navigator.clipboard.writeText(s.total.toFixed(2));
                                    toast({ title: "복사했습니다", description: `${s.name} $${s.total.toFixed(2)} 복사됨` });
                                  } catch {
                                    toast({ title: "복사에 실패했습니다", variant: "destructive" });
                                  }
                                }}
                                data-testid={`button-copy-supplier-total-${s.name.replace(/\s+/g, "-").toLowerCase()}`}
                                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                                title={`${s.name} 합계 복사`}
                                aria-label={`${s.name} 합계 복사`}
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">선택 없음</p>
                    )}
                  </div>
                  <CheckCircle className={`h-4 w-4 shrink-0 mt-0.5 transition-colors ${selected.size > 0 ? "text-primary" : "text-muted-foreground"}`} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Tab bar + Pay action ─────────────────────────────────────
              On mobile the tab strip wraps to a second line and tab labels
              shrink so all options stay reachable without horizontal scroll. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-0.5 sm:gap-1 bg-muted p-0.5 sm:p-1 rounded-lg flex-wrap">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`tab-${tab.key}`}
                >
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span className={`ml-1 sm:ml-2 text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded-full font-semibold ${
                      activeTab === tab.key ? tab.badgeColor : "bg-muted text-muted-foreground"
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="hidden sm:block flex-1" />

            {activeTab === "topay" && selected.size > 0 && (
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <span className="text-xs sm:text-sm font-semibold tabular-nums text-foreground whitespace-nowrap" data-testid="text-selected-total">
                  {fmtAUD(selectedTotal)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 sm:h-9 px-2.5 text-xs sm:text-sm"
                  onClick={clearSelection}
                  data-testid="button-clear-selection"
                >
                  선택 해제
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  disabled={bulkSoftDeleteMutation.isPending || visibleSelectedIds.length === 0}
                  data-testid="button-bulk-delete"
                  className="h-8 sm:h-9 px-2.5 text-xs sm:text-sm gap-1 sm:gap-1.5 whitespace-nowrap text-destructive border-destructive/40 hover:bg-destructive/5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  삭제 ({visibleSelectedIds.length})
                </Button>
                <Button
                  size="sm"
                  onClick={() => setPayConfirmOpen(true)}
                  disabled={bulkMarkPaidMutation.isPending || visibleSelectedIds.length === 0}
                  data-testid="button-bulk-mark-paid"
                  className="h-8 sm:h-9 px-2.5 text-xs sm:text-sm gap-1 sm:gap-1.5 whitespace-nowrap flex-1 sm:flex-initial"
                >
                  {bulkMarkPaidMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />지급 처리 중…</>
                  ) : (
                    <><CheckCircle className="h-3.5 w-3.5" />선택 항목 지급 ({visibleSelectedIds.length})</>
                  )}
                </Button>
              </div>
            )}
          </div>

        </div>
        {/* ── /Sticky header ─────────────────────────────────────────────── */}

        {/* ── Store Filter row + Add Invoice (right end) ─────────────────
            Owner request: Add Invoice button now sits at the right end of
            this row instead of a separate top-of-page action bar. Row
            scrolls with the content (not part of the sticky header). */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {showStoreFilter && (
          <div className="flex items-center gap-1 flex-wrap">
            {[
              ...filteredStores.map(s => ({ id: s.id, label: s.name })),
              { id: "ALL", label: "All Stores" },
              { id: "UNASSIGNED", label: "⚠ Unassigned" },
            ].map(opt => {
              const isActive = storeFilter === opt.id;
              const isUnassigned = opt.id === "UNASSIGNED";
              const brandColor =
                opt.label.toLowerCase().includes("sushi") ? "#222222" :
                opt.label.toLowerCase().includes("sandwich") ? "#ef4444" :
                isUnassigned ? "#ef4444" : null;
              return (
                <button
                  key={opt.id}
                  onClick={() => setStoreFilter(opt.id)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium border transition-colors ${
                    isActive
                      ? "text-white border-transparent"
                      : isUnassigned && unassignedCount > 0
                        ? "border-destructive/50 text-destructive hover:border-destructive"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  }`}
                  style={isActive ? { backgroundColor: brandColor ?? "#1a1a1a", borderColor: brandColor ?? "#1a1a1a" } : {}}
                  data-testid={`button-store-filter-${opt.id}`}
                >
                  {opt.label}
                  {isUnassigned && unassignedCount > 0 && (
                    <span className={`ml-1 sm:ml-1.5 text-[10px] sm:text-xs ${isActive ? "opacity-90" : "opacity-80"}`}>
                      {unassignedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          )}

          <div className="hidden sm:block flex-1" />

          <Button
            size="sm"
            onClick={() => setAddInvoiceOpen(true)}
            data-testid="button-add-invoice"
            className="shrink-0 ml-auto sm:ml-0 h-8 sm:h-9 px-2.5 sm:px-3 text-xs sm:text-sm"
          >
            <Plus className="w-4 h-4 mr-1 sm:mr-1.5" />
            Add Invoice
          </Button>
        </div>

        {/* ── Content Area ───────────────────────────────────────────────── */}

        {/* ── TO PAY ── */}
        {activeTab === "topay" && <GmailInboxPanel />}
        {activeTab === "topay" && <LinkedPdfPanel />}
        {activeTab === "topay" && (
          isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">인보이스 불러오는 중…</span>
            </div>
          ) : toPayInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <CheckCircle className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">모든 인보이스가 지급 완료되었습니다</p>
              <p className="text-xs">이 매장 필터에는 남은 미지급 건이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {unassignedToPayCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    매장이 지정되지 않은 인보이스 {unassignedToPayCount}건은 여기에 보이지 않습니다.
                  </span>
                  <button
                    className="ml-auto underline underline-offset-2 font-medium hover:opacity-80 whitespace-nowrap"
                    onClick={() => setStoreFilter("ALL")}
                  >
                    All Stores에서 보기
                  </button>
                </div>
              )}
              <Accordion
                type="multiple"
                value={openAccordions}
                onValueChange={setOpenAccordions}
                className="space-y-3"
              >
                {supplierGroups.map(group => {
                  const allGroupSelected = group.invoices.every(inv => selected.has(inv.id));
                  const someGroupSelected = group.invoices.some(inv => selected.has(inv.id));
                  const groupSelectedTotal = group.invoices
                    .filter(inv => selected.has(inv.id))
                    .reduce((s, inv) => s + (inv.amount ?? 0), 0);
                  const groupSelectedCount = group.invoices.filter(inv => selected.has(inv.id)).length;

                  return (
                    <AccordionItem
                      key={group.supplierId}
                      value={group.supplierId}
                      className={`group border rounded-lg bg-card overflow-hidden ${group.isAutoPay ? "border-border/25 opacity-75" : "border-border/40"}`}
                      data-testid={`supplier-group-${group.supplierId}`}
                    >
                      {/* Header — bottom border appears only when expanded.
                          Mobile: header stacks into 2 rows (name+chevron, then
                          totals/overdue) so long supplier names + amounts both
                          stay readable on a 375px viewport. */}
                      <AccordionPrimitive.Header className="flex items-start sm:items-center w-full px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-muted/20 transition-colors group-data-[state=open]:border-b group-data-[state=open]:border-border/20">
                        {/* Checkbox: hidden for Auto-Pay suppliers, replaced with spacer */}
                        {group.isAutoPay ? (
                          <div className="w-4 h-4 mr-2 sm:mr-3 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                        ) : (
                          <Checkbox
                            checked={allGroupSelected}
                            data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                            onCheckedChange={() => toggleSupplier(group)}
                            aria-label={`${group.supplierName} 인보이스 모두 선택`}
                            data-testid={`checkbox-supplier-${group.supplierId}`}
                            className="mr-2 sm:mr-3 shrink-0 mt-0.5 sm:mt-0"
                          />
                        )}

                        <AccordionPrimitive.Trigger className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 flex-1 min-w-0 text-left">
                          {/* LEFT — supplier name + badge + count */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <p className="font-semibold text-sm truncate">{group.supplierName}</p>
                            {group.isAutoPay && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 whitespace-nowrap shrink-0" data-testid={`badge-autopay-${group.supplierId}`}>
                                <Zap className="h-2.5 w-2.5" />
                                <span className="hidden sm:inline">자동이체</span>
                                <span className="sm:hidden">DD</span>
                              </span>
                            )}
                            <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">
                              {group.invoices.length}건
                            </span>
                          </div>

                          {/* CENTRE — total + selected */}
                          <div className="flex items-center gap-2 sm:shrink-0 flex-wrap">
                            <div className="flex flex-col items-start sm:items-end">
                              <span className="text-sm font-semibold tabular-nums text-foreground">
                                {fmtAUD(group.totalAmount)}
                              </span>
                              {/* §7 Wave 1 Day 5: aggregated GST estimate per supplier group */}
                              {(() => {
                                const rate = group.invoices[0]?.supplier?.defaultGstRate ?? 0;
                                if (rate <= 0) return null;
                                const est = Math.round((group.totalAmount * rate / 100 / 11) * 100) / 100;
                                return (
                                  <span className="text-[10px] text-muted-foreground/80 tabular-nums">
                                    GST ~{fmtAUD(est)}
                                  </span>
                                );
                              })()}
                            </div>
                            {groupSelectedCount > 0 && (
                              <span className="text-xs sm:text-sm font-bold tabular-nums text-primary flex items-center gap-1">
                                <CheckCircle className="h-3.5 w-3.5" />
                                {fmtAUD(groupSelectedTotal)}
                                <span className="text-[10px] sm:text-xs font-medium opacity-75">({groupSelectedCount})</span>
                              </span>
                            )}
                            {group.overdueAmount > 0 && (
                              <span className="text-[10px] sm:text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                <span className="hidden sm:inline">연체: </span>{fmtAUD(group.overdueAmount)}
                              </span>
                            )}
                          </div>
                        </AccordionPrimitive.Trigger>
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180 ml-2 mt-1 sm:mt-0" />
                      </AccordionPrimitive.Header>

                      <AccordionContent className="pb-0">
                        {(() => {
                          const sortedInvoices = [...group.invoices].sort(
                            (a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "")
                          );
                          // Week buckets keyed by Monday-of-week string.
                          // Only apply alternating color bands when at least
                          // one week contains multiple invoices (skip
                          // monthly-cadence suppliers).
                          const weekIdxById = new Map<string, number>();
                          const weekCounts = new Map<string, number>();
                          const weekOrder: string[] = [];
                          for (const i of sortedInvoices) {
                            const k = getMondayStr(i.invoiceDate);
                            if (!weekOrder.includes(k)) weekOrder.push(k);
                            weekIdxById.set(i.id, weekOrder.indexOf(k));
                            weekCounts.set(k, (weekCounts.get(k) ?? 0) + 1);
                          }
                          const applyWeekBands = Array.from(weekCounts.values()).some(n => n > 1);
                          return (
                            <div className="bg-muted/20 dark:bg-muted/10">
                              {/* Mobile: card layout (each invoice is a stacked card). */}
                              <div className="sm:hidden divide-y divide-border/20" data-testid={`invoice-cards-${group.supplierId}`}>
                                {sortedInvoices.map((inv) => {
                                  const overdue = isOverdue(inv.dueDate, inv.status);
                                  const dueSoon = isDueSoon(inv.dueDate, inv.status);
                                  const isChecked = selected.has(inv.id);
                                  const store = stores.find(s => s.id === inv.storeId);
                                  const isAutoDebitRow = inv.supplier?.isAutoPay === true;
                                  const weekIdx = weekIdxById.get(inv.id) ?? 0;
                                  const weekBandBg = applyWeekBands && weekIdx % 2 === 1
                                    ? "bg-slate-200/40 dark:bg-slate-700/30"
                                    : "";
                                  const rate = inv.supplier?.defaultGstRate ?? 0;
                                  const gstEst = rate > 0
                                    ? Math.round(((inv.amount ?? 0) * rate / 100 / 11) * 100) / 100
                                    : null;
                                  return (
                                    <div
                                      key={inv.id}
                                      className={`px-3 py-3 ${
                                        isChecked ? "bg-primary/10" : weekBandBg
                                      } ${isAutoDebitRow ? "opacity-60" : ""}`}
                                      data-testid={`card-invoice-${inv.id}`}
                                    >
                                      {/* Top row: checkbox + date + amount */}
                                      <div className="flex items-center gap-2">
                                        {isAutoDebitRow ? (
                                          <div className="w-4 h-4 shrink-0" aria-hidden="true" />
                                        ) : (
                                          <Checkbox
                                            checked={isChecked}
                                            onClick={(e) => { shiftKeyPressedRef.current = (e as React.MouseEvent).shiftKey; }}
                                            onCheckedChange={() => handleRowCheckbox(inv.id, group)}
                                            aria-label={`인보이스 ${inv.invoiceNumber} 선택`}
                                            data-testid={`checkbox-invoice-mobile-${inv.id}`}
                                            className="shrink-0"
                                          />
                                        )}
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                          {fmt(inv.invoiceDate)}
                                        </span>
                                        <div className="flex-1 min-w-0" />
                                        <div className="flex flex-col items-end">
                                          <div className="flex items-center gap-1 font-semibold tabular-nums text-sm">
                                            {fmtAUD(inv.amount ?? 0)}
                                            {isAutoDebitRow && (
                                              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
                                                <Zap className="h-2 w-2" />
                                                DD
                                              </span>
                                            )}
                                          </div>
                                          {gstEst !== null && (
                                            <span className="text-[10px] text-muted-foreground/80 tabular-nums" title={`이 공급처는 기본으로 ${rate}%에 GST가 붙습니다`}>
                                              GST ~{fmtAUD(gstEst)}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Middle row: due date + invoice number */}
                                      <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                                        <span className="text-muted-foreground shrink-0">Due:</span>
                                        {inv.dueDate ? (
                                          <span className={
                                            overdue
                                              ? "text-red-600 dark:text-red-400 font-semibold flex items-center gap-1"
                                              : dueSoon
                                                ? "text-orange-600 dark:text-orange-400 font-medium flex items-center gap-1"
                                                : "text-foreground"
                                          }>
                                            {overdue && <AlertCircle className="h-3 w-3 shrink-0" />}
                                            {dueSoon && !overdue && <Clock className="h-3 w-3 shrink-0" />}
                                            {fmt(inv.dueDate)}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                        <span className="text-muted-foreground/50">·</span>
                                        <span className="font-mono text-[11px] text-muted-foreground truncate">
                                          {displayInvNumber(inv.invoiceNumber)}
                                        </span>
                                        <DocBadge status={inv.docStatus} />
                                      </div>

                                      {/* Bottom row: store select + actions */}
                                      <div className="flex items-center gap-1.5 mt-2">
                                        <select
                                          className={`flex-1 min-w-0 h-8 text-xs rounded px-2 ${
                                            store
                                              ? "border border-border text-muted-foreground bg-transparent"
                                              : "border border-destructive/50 bg-destructive/5 text-destructive"
                                          }`}
                                          value={store?.id ?? ""}
                                          onChange={async (e) => {
                                            const v = e.target.value;
                                            if (!v || v === inv.storeId) return;
                                            try {
                                              await apiRequest("PATCH", `/api/invoices/${inv.id}/store`, { storeId: v });
                                              queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                                              toast({ title: "매장을 바꿨습니다" });
                                            } catch (err: any) {
                                              toast({ title: "매장 변경에 실패했습니다", description: err?.message, variant: "destructive" });
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          data-testid={`select-store-mobile-${inv.id}`}
                                        >
                                          {!store && <option value="">⚠ 매장 지정…</option>}
                                          {filteredStores.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                          ))}
                                        </select>
                                        {((inv.rawExtractedData as any)?.pdfBase64 || inv.notes || (inv.rawExtractedData as any)?.body) && (
                                          <button
                                            type="button"
                                            title={(inv.rawExtractedData as any)?.pdfBase64 ? "PDF 인보이스 보기" : "원본 이메일 / 메모 보기"}
                                            className={`h-8 w-8 flex items-center justify-center rounded transition-colors ${(inv.rawExtractedData as any)?.pdfBase64 ? "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" : "text-muted-foreground hover:text-foreground"}`}
                                            data-testid={`button-notes-mobile-${inv.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if ((inv.rawExtractedData as any)?.pdfBase64) {
                                                openInvoicePdf(inv.id);
                                              } else {
                                                setViewEmailInvoice(inv);
                                              }
                                            }}
                                          >
                                            <FileText className="h-4 w-4" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          title="공급처 변경"
                                          className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground/60 hover:text-primary transition-colors"
                                          data-testid={`button-reassign-invoice-mobile-${inv.id}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setReassignInvoice(inv);
                                          }}
                                        >
                                          <Link2 className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          title="휴지통으로 이동"
                                          className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive transition-colors"
                                          data-testid={`button-softdelete-invoice-mobile-${inv.id}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            softDeleteMutation.mutate(inv.id);
                                          }}
                                          disabled={softDeleteMutation.isPending && softDeleteMutation.variables === inv.id}
                                        >
                                          {softDeleteMutation.isPending && softDeleteMutation.variables === inv.id
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <Trash2 className="h-4 w-4" />}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Desktop: original table layout. */}
                              <table className="hidden sm:table w-full text-sm" data-testid={`invoice-table-${group.supplierId}`}>
                                <thead>
                                  <tr className="bg-muted/30 border-b border-border/20">
                                    <th className="w-10 py-2 pl-4" />
                                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Due Date</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Store</th>
                                    <th className="w-16 py-2 pr-4" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedInvoices.map((inv) => {
                                  const overdue = isOverdue(inv.dueDate, inv.status);
                                  const dueSoon = isDueSoon(inv.dueDate, inv.status);
                                  const isChecked = selected.has(inv.id);
                                  const store = stores.find(s => s.id === inv.storeId);
                                  const isAutoDebitRow = inv.supplier?.isAutoPay === true;
                                  const weekIdx = weekIdxById.get(inv.id) ?? 0;
                                  // Deeper neutral so the band is clearly
                                  // readable without looking like an accent.
                                  const weekBandBg = applyWeekBands && weekIdx % 2 === 1
                                    ? "bg-slate-200/80 dark:bg-slate-700/50"
                                    : "";
                                  // Hover uses a cool blue tint — clearly
                                  // distinct from the neutral-grey week band
                                  // so mouse-over state isn't mistaken for
                                  // the banding.
                                  return (
                                    <tr
                                      key={inv.id}
                                      className={`transition-colors ${
                                        isChecked
                                          ? "bg-primary/10"
                                          : `${weekBandBg} hover:bg-blue-50 dark:hover:bg-blue-950/40`
                                      } ${isAutoDebitRow ? "opacity-60" : ""}`}
                                      data-testid={`row-invoice-${inv.id}`}
                                    >
                                      <td className="pl-4 py-2.5 w-10">
                                        {isAutoDebitRow ? (
                                          /* No checkbox for auto-pay invoices — selection is disabled */
                                          <div className="w-4 h-4" aria-hidden="true" data-testid={`no-checkbox-autopay-${inv.id}`} />
                                        ) : (
                                          <Checkbox
                                            checked={isChecked}
                                            onClick={(e) => { shiftKeyPressedRef.current = (e as React.MouseEvent).shiftKey; }}
                                            onCheckedChange={() => handleRowCheckbox(inv.id, group)}
                                            aria-label={`인보이스 ${inv.invoiceNumber} 선택`}
                                            data-testid={`checkbox-invoice-${inv.id}`}
                                          />
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                                        {fmt(inv.invoiceDate)}
                                      </td>
                                      <td className="py-2.5 px-3 font-semibold tabular-nums text-right whitespace-nowrap">
                                        <div className="flex items-center justify-end gap-1.5">
                                          {fmtAUD(inv.amount ?? 0)}
                                          {isAutoDebitRow && (
                                            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400 whitespace-nowrap" data-testid={`badge-autopay-row-${inv.id}`}>
                                              <Zap className="h-2 w-2" />
                                              DD
                                            </span>
                                          )}
                                        </div>
                                        {/* §7 Wave 1 Day 5: GST estimate from supplier.defaultGstRate.
                                            UI-only; supplier_invoices.gst_amount lands in Wave 3. */}
                                        {(() => {
                                          const rate = inv.supplier?.defaultGstRate ?? 0;
                                          if (rate <= 0) return null;
                                          const est = Math.round(((inv.amount ?? 0) * rate / 100 / 11) * 100) / 100;
                                          return (
                                            <div
                                              className="text-[10px] font-normal text-muted-foreground/80 mt-0.5"
                                              title={`이 공급처는 기본으로 ${rate}%에 GST가 붙습니다 (추정치).`}
                                              data-testid={`text-gst-estimate-${inv.id}`}
                                            >
                                              GST ~{fmtAUD(est)} ({rate}%)
                                            </div>
                                          );
                                        })()}
                                      </td>
                                      <td className="py-2.5 px-3 whitespace-nowrap">
                                        {inv.dueDate ? (
                                          <span className={
                                            overdue
                                              ? "text-red-600 dark:text-red-400 font-semibold flex items-center gap-1"
                                              : dueSoon
                                                ? "text-orange-600 dark:text-orange-400 font-medium flex items-center gap-1"
                                                : "text-muted-foreground"
                                          }>
                                            {overdue && <AlertCircle className="h-3 w-3 shrink-0" />}
                                            {dueSoon && !overdue && <Clock className="h-3 w-3 shrink-0" />}
                                            {fmt(inv.dueDate)}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">
                                        {displayInvNumber(inv.invoiceNumber)} <DocBadge status={inv.docStatus} />
                                      </td>
                                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                                        {/* Always a select so the owner can correct
                                            mis-assigned invoices (e.g., AGL row tagged
                                            Sushi but actually for Sandwich). When
                                            unassigned the select is highlighted red so
                                            it still flags a missing store. */}
                                        <select
                                          className={`h-7 text-xs rounded px-1.5 ${
                                            store
                                              ? "border border-border text-muted-foreground bg-transparent hover:border-foreground/40"
                                              : "border border-destructive/50 bg-destructive/5 text-destructive"
                                          }`}
                                          value={store?.id ?? ""}
                                          onChange={async (e) => {
                                            const v = e.target.value;
                                            if (!v || v === inv.storeId) return;
                                            try {
                                              await apiRequest("PATCH", `/api/invoices/${inv.id}/store`, { storeId: v });
                                              queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                                              toast({ title: "매장을 바꿨습니다" });
                                            } catch (err: any) {
                                              toast({ title: "매장 변경에 실패했습니다", description: err?.message, variant: "destructive" });
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          data-testid={`select-store-${inv.id}`}
                                        >
                                          {!store && <option value="">⚠ 매장 지정…</option>}
                                          {filteredStores.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                          ))}
                                        </select>
                                      </td>
                                      <td className="py-2.5 pr-4 w-20">
                                        <div className="flex items-center gap-0.5 justify-end">
                                          {((inv.rawExtractedData as any)?.pdfBase64 || inv.notes || (inv.rawExtractedData as any)?.body) && (
                                            <button
                                              type="button"
                                              title={(inv.rawExtractedData as any)?.pdfBase64 ? "PDF 인보이스 보기" : "원본 이메일 / 메모 보기"}
                                              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${(inv.rawExtractedData as any)?.pdfBase64 ? "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" : "text-muted-foreground hover:text-foreground"}`}
                                              data-testid={`button-notes-${inv.id}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if ((inv.rawExtractedData as any)?.pdfBase64) {
                                                  openInvoicePdf(inv.id);
                                                } else {
                                                  // No PDF — fall back to the source-email
                                                  // viewer so the owner can read the body
                                                  // text and notes (typical for AGL/utility
                                                  // invoices parsed from email body).
                                                  setViewEmailInvoice(inv);
                                                }
                                              }}
                                            >
                                              <FileText className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            title="공급처 변경"
                                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/30 hover:text-primary transition-colors"
                                            data-testid={`button-reassign-invoice-${inv.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setReassignInvoice(inv);
                                            }}
                                          >
                                            <Link2 className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            title="휴지통으로 이동"
                                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/30 hover:text-destructive transition-colors"
                                            data-testid={`button-softdelete-invoice-${inv.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              softDeleteMutation.mutate(inv.id);
                                            }}
                                            disabled={softDeleteMutation.isPending && softDeleteMutation.variables === inv.id}
                                          >
                                            {softDeleteMutation.isPending && softDeleteMutation.variables === inv.id
                                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                              : <Trash2 className="h-3.5 w-3.5" />}
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          )
        )}

        {/* ── REVIEW INBOX ── */}
        {activeTab === "review" && (
          reviewLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">검토함 불러오는 중…</span>
            </div>
          ) : reviewGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Inbox className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">검토할 항목이 없습니다</p>
              <p className="text-xs">모르는 보낸 사람에게서 온 새 인보이스가 여기에 나타납니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Backfill: re-run the 4-way classifier + supplier fallback on
                  every stuck REVIEW + QUARANTINE row. Mirrors the bar in the
                  Quarantine tab so the owner can trigger it from wherever the
                  backlog is most visible. */}
              <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-center justify-between gap-3">
                <div className="text-xs text-blue-800 dark:text-blue-200 min-w-0">
                  <strong>일괄 재분류</strong> — 검토함(Review Inbox)과 격리함(Quarantine)에 멈춰 있는 건을 한 번에 다시 분류합니다. AI가 읽은 이름·이메일로 공급처를 자동 연결해서, 가능한 건은 To Pay로 옮깁니다.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  onClick={async () => {
                    if (!window.confirm("검토함·격리함에 멈춰 있는 인보이스를 모두 다시 분류할까요? PDF가 있는 인보이스는 To Pay로 옮기고, 송금 확인서(remittance)는 휴지통으로 보냅니다. 끝나면 결과 요약을 볼 수 있습니다.")) return;
                    try {
                      const res = await apiRequest("POST", "/api/invoices/bulk-reclassify", {});
                      const s = await res.json();
                      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                      const reasons = s.reasons ? ` (PDF 없음: ${s.reasons.noPdf ?? 0}, 글자 없음: ${s.reasons.pdfTextEmpty ?? 0}, AI 결과 없음: ${s.reasons.aiReturnedNothing ?? 0}, 읽었지만 비어 있음: ${s.reasons.parsedButEmpty ?? 0}, 공급처 못 찾음: ${s.reasons.noSupplierMatch ?? 0})` : "";
                      const linked = (s.linkedByName ?? 0) + (s.linkedByEmail ?? 0);
                      const linkedDetail = linked > 0 ? ` · 공급처 자동 연결 ${linked}건 (이름으로 ${s.linkedByName ?? 0}, 이메일로 ${s.linkedByEmail ?? 0})` : "";
                      toast({
                        title: "재분류를 마쳤습니다",
                        description: `To Pay로 ${s.promoted}건 · 명세서에서 ${s.statementExpanded}건 · 버림 ${s.dropped}건 · 직접 처리 필요 ${s.needsManual}건${linkedDetail}${reasons} · 오류 ${s.errors}건.`,
                      });
                    } catch (e: any) {
                      toast({ title: "재분류에 실패했습니다", description: e?.message ?? "다시 시도하세요.", variant: "destructive" });
                    }
                  }}
                  data-testid="button-bulk-reclassify-review"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  멈춘 인보이스 모두 재분류
                </Button>
              </div>

              {reviewGroups.map(group => {
                const raw = group.rawFirst;
                const isPending = ignoreSenderMutation.isPending;
                // Use ABN (if known) or first invoice ID as the stable groupKey for React keys and test IDs
                const groupKey = group.abn || group.invoices[0]?.id || group.supplierName;
                // Detect "rule matched but supplier missing" placeholders: supplierId is null
                // AND the invoice_number is one of our auto-generated forms (TRIAGE-/EMAIL-).
                // These arrive from auto-routing when ROUTE_TO_AP rule exists without a supplier.
                const isRulePlaceholder = group.invoices.some(inv =>
                  !inv.supplierId && /^(TRIAGE-|EMAIL-)/.test(inv.invoiceNumber ?? "")
                );
                // Detect "AI parse hasn't finished" placeholders: auto-generated invoice
                // number AND amount is 0/null. Approving these sends them to Quarantine
                // (correct behaviour — $0 junk guard) but the manager needs to know.
                const unparsedCount = group.invoices.filter(inv =>
                  (!inv.amount || inv.amount <= 0) && /^(TRIAGE-|EMAIL-)/.test(inv.invoiceNumber ?? "")
                ).length;
                const hasUnparsed = unparsedCount > 0;

                return (
                  <Card key={groupKey} className="overflow-hidden" data-testid={`review-card-${groupKey}`}>
                    <CardContent className="p-0">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/30 bg-muted/20">
                        <div className="flex items-start gap-3 min-w-0">
                          <Mail className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate" data-testid={`text-review-supplier-${groupKey}`}>
                                {group.supplierName}
                              </p>
                              {isRulePlaceholder && (
                                <span
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-destructive/10 text-destructive border border-destructive/30"
                                  title="메일 규칙에 따라 자동으로 들어왔지만 맞는 공급처를 찾지 못했습니다. 아래에서 승인하면서 공급처를 만들거나 연결하세요."
                                  data-testid={`badge-rule-placeholder-${groupKey}`}
                                >
                                  <AlertCircle className="h-3 w-3" />
                                  공급처 지정 필요 (규칙으로 들어옴)
                                </span>
                              )}
                              {hasUnparsed && (
                                <span
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700"
                                  title="AI가 아직 이 인보이스들을 읽지 못했습니다. 지금 승인하면 $0짜리로 격리됩니다. ‘PDF 다시 읽기’를 누르거나 잠시 기다리세요. 아니면 먼저 금액을 직접 입력하세요."
                                  data-testid={`badge-unparsed-${groupKey}`}
                                >
                                  <AlertCircle className="h-3 w-3" />
                                  {unparsedCount}건 아직 못 읽음 — 지금 승인하면 격리됩니다
                                </span>
                              )}
                            </div>
                            {group.abn && (
                              <p className="text-xs text-muted-foreground" data-testid={`text-review-abn-${groupKey}`}>
                                ABN {group.abn}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground" data-testid={`text-review-count-${groupKey}`}>
                              {group.invoices.length === 1
                                ? "대기 중인 인보이스 1건"
                                : `대기 중인 인보이스 ${group.invoices.length}건`}
                            </p>
                            {group.senderEmail && (
                              <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                                보낸 곳: {group.senderEmail}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {group.totalAmount > 0 && (
                            <p className="font-bold text-sm tabular-nums" data-testid={`text-review-amount-${groupKey}`}>
                              {fmtAUD(group.totalAmount)}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">합계</p>
                        </div>
                      </div>

                      {/* Supplier details (from first invoice) */}
                      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                        {raw?.supplier?.abn && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground shrink-0 w-20">ABN</span>
                            <span className="font-medium">{raw.supplier.abn}</span>
                          </div>
                        )}
                        {raw?.supplier?.bsb && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground shrink-0 w-20">BSB</span>
                            <span className="font-medium font-mono">{raw.supplier.bsb}</span>
                          </div>
                        )}
                        {raw?.supplier?.accountNumber && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground shrink-0 w-20">계좌번호</span>
                            <span className="font-medium font-mono">{raw.supplier.accountNumber}</span>
                          </div>
                        )}
                        {(raw?.supplier?.supplierAddress ?? raw?.supplier?.address) && (
                          <div className="flex gap-2 col-span-2">
                            <span className="text-muted-foreground shrink-0 w-20">주소</span>
                            <span className="font-medium">{raw!.supplier.supplierAddress ?? raw!.supplier.address}</span>
                          </div>
                        )}
                      </div>

                      {/* Individual invoice list */}
                      {group.invoices.length > 0 && (
                        <div className="px-4 pb-3 space-y-1">
                          {group.invoices.map(inv => {
                            const ir = inv.rawExtractedData as ReviewRawData | null;
                            const emailInfo = parseNotesEmailInfo(inv.notes);
                            const isDeleting = deleteInvoiceMutation.isPending && deleteInvoiceMutation.variables === inv.id;
                            const hasUsefulInvoiceData = displayInvNumber(ir?.invoiceNumber) !== "—" || ir?.totalAmount;
                            return (
                              <div key={inv.id} className="py-2 border-t border-border/20 first:border-t-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    {/* Invoice # + amount + received time */}
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="text-muted-foreground font-mono text-xs">
                                        {displayInvNumber(ir?.invoiceNumber) !== "—" ? `#${ir?.invoiceNumber}` : "인보이스 번호 없음"}
                                      </span>
                                      {ir?.issueDate && <span className="text-muted-foreground text-xs">{fmt(ir.issueDate)}</span>}
                                      {ir?.totalAmount !== undefined && ir.totalAmount > 0 && (
                                        <span className="font-medium tabular-nums text-xs">{fmtAUD(ir.totalAmount)}</span>
                                      )}
                                      {(ir as any)?._isStatement && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-700 border-amber-400 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30 shrink-0">
                                          명세서
                                        </Badge>
                                      )}
                                      {inv.createdAt && (
                                        <span className="text-muted-foreground/60 text-xs ml-auto">
                                          받음 {fmtReceived(inv.createdAt)}
                                        </span>
                                      )}
                                    </div>
                                    {/* Email subject — always show if available */}
                                    {emailInfo.subject && (
                                      <p className="text-xs font-medium text-foreground truncate leading-snug">
                                        {emailInfo.subject}
                                      </p>
                                    )}
                                    {/* Sender */}
                                    {emailInfo.from && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        보낸 사람: {emailInfo.from}
                                      </p>
                                    )}
                                    {/* Notes fallback when no structured data at all */}
                                    {!hasUsefulInvoiceData && !emailInfo.subject && !emailInfo.from && inv.notes && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                        {inv.notes.slice(0, 160)}
                                      </p>
                                    )}
                                    {/* AI parser reasoning (from webhook claude mode) */}
                                    {(inv.rawExtractedData as any)?._reasoning && (
                                      <p className="text-xs text-muted-foreground italic mt-1" data-testid={`text-parser-reasoning-${inv.id}`}>
                                        AI: {(inv.rawExtractedData as any)._reasoning}
                                        {(inv.rawExtractedData as any)?._confidence
                                          ? ` (문서 ${Math.round(((inv.rawExtractedData as any)._confidence.docType ?? 0) * 100)}% / 매장 ${Math.round(((inv.rawExtractedData as any)._confidence.store ?? 0) * 100)}%)`
                                          : ""}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
                                      onClick={() => setViewEmailInvoice(inv)}
                                      data-testid={`button-view-email-${inv.id}`}
                                      title="이메일 전체 보기"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                      disabled={isDeleting}
                                      onClick={() => deleteInvoiceMutation.mutate(inv.id)}
                                      data-testid={`button-delete-invoice-${inv.id}`}
                                      title="인보이스 삭제"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 px-4 py-3 border-t border-border/30 bg-muted/10">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            ignoreSenderMutation.mutate({
                              invoiceIds: group.invoices.map(i => i.id),
                              senderEmail: group.rawSenderEmail,
                              supplierName: group.supplierName !== "Unknown Supplier" ? group.supplierName : undefined,
                            })
                          }
                          disabled={isPending}
                          data-testid={`button-ignore-${groupKey}`}
                          className="gap-1.5"
                        >
                          {isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                          공급처 무시
                        </Button>
                        {/* Re-parse PDF button — only for groups that have a stored PDF */}
                        {group.invoices.some(i => (i.rawExtractedData as any)?.pdfBase64) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const invWithPdf = group.invoices.find(i => (i.rawExtractedData as any)?.pdfBase64);
                              if (invWithPdf) reparsePdfMutation.mutate(invWithPdf.id);
                            }}
                            disabled={reparsePdfMutation.isPending}
                            data-testid={`button-reparse-${groupKey}`}
                            className="gap-1.5"
                          >
                            {reparsePdfMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            PDF 다시 읽기
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => {
                            if (hasUnparsed) {
                              const ok = window.confirm(
                                `이 중 ${unparsedCount}건은 아직 AI가 읽지 못했습니다 (금액 = $0).\n\n` +
                                `지금 승인하면 그 건들은 Quarantine(격리함)으로 갑니다 ($0짜리 잘못된 건을 막는 장치). ` +
                                `금액을 제대로 읽은 인보이스는 그대로 To Pay로 갑니다.\n\n` +
                                `추천: 먼저 "PDF 다시 읽기"를 누르거나 금액을 직접 고친 뒤 승인하세요.\n\n` +
                                `그래도 계속할까요?`
                              );
                              if (!ok) return;
                            }
                            setApproveInvoiceGroup(group.invoices);
                          }}
                          data-testid={`button-approve-${groupKey}`}
                          className="gap-1.5"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          승인하고 공급처 추가
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        )}

        {/* ── PAID HISTORY ── */}
        {activeTab === "history" && <DocStatusSummary invoices={allInvoices} />}
        {activeTab === "statements" && <StatementsTab />}
        {activeTab === "history" && (
          isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">지급 내역 불러오는 중…</span>
            </div>
          ) : historyInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Receipt className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">지급 완료된 인보이스가 없습니다</p>
              <p className="text-xs">지급 완료된 인보이스가 여기에 나타납니다.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {historyGrouped.map(([dateKey, invoices]) => {
                const isExpanded = expandedPayDates.has(dateKey);
                const groupTotal = invoices.reduce((s, inv) => s + (inv.amount ?? 0), 0);
                const displayDate = dateKey
                  ? new Date(dateKey + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
                  : "날짜 모름";
                return (
                  <Card key={dateKey} className="overflow-hidden">
                    {/* ── Group header (always visible) ── */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover-elevate transition-colors"
                      onClick={() => togglePayDate(dateKey)}
                      data-testid={`button-paydate-${dateKey}`}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <span className="font-semibold text-sm flex-1">{displayDate}</span>
                      <span className="text-xs text-muted-foreground mr-3">
                        인보이스 {invoices.length}건
                      </span>
                      <span className="font-semibold tabular-nums text-sm">{fmtAUD(groupTotal)}</span>
                    </button>

                    {/* ── Expanded rows: grouped by supplier ── */}
                    {isExpanded && (
                      <CardContent className="p-0 border-t border-border/40">
                        {(() => {
                          // Group invoices by supplier within this date group
                          const suppMap = new Map<string, { name: string; suppInvoices: typeof invoices }>();
                          for (const inv of invoices) {
                            const key = inv.supplierId ?? `unknown-${inv.id}`;
                            const name = inv.supplier?.name ?? "Unknown Supplier";
                            if (!suppMap.has(key)) suppMap.set(key, { name, suppInvoices: [] });
                            suppMap.get(key)!.suppInvoices.push(inv);
                          }
                          const suppGroups = Array.from(suppMap.entries())
                            .sort(([, a], [, b]) => a.name.localeCompare(b.name));

                          return suppGroups.map(([suppId, { name: suppName, suppInvoices }], suppIdx) => {
                            const suppKey = `${dateKey}:${suppId}`;
                            // Supplier groups are collapsed by default; expanded only if explicitly toggled
                            const isSuppExpanded = expandedHistorySuppliers.has(suppKey);
                            const suppTotal = suppInvoices.reduce((s, inv) => s + (inv.amount ?? 0), 0);

                            return (
                              <div key={suppKey} className={suppIdx > 0 ? "border-t border-border/30" : ""}>
                                {/* Supplier sub-header */}
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover-elevate transition-colors bg-muted/15"
                                  onClick={() => toggleHistorySupplier(suppKey)}
                                  data-testid={`button-history-supplier-${suppKey}`}
                                >
                                  {isSuppExpanded
                                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  }
                                  <span className="font-semibold text-sm flex-1 truncate">{suppName}</span>
                                  <span className="text-xs text-muted-foreground mr-3 shrink-0">
                                    인보이스 {suppInvoices.length}건
                                  </span>
                                  <span className="font-semibold tabular-nums text-sm shrink-0">{fmtAUD(suppTotal)}</span>
                                </button>

                                {/* Invoice rows for this supplier — wrapped in
                                    horizontal-scroll container so the table can
                                    overflow on mobile without forcing the page
                                    to scroll sideways. */}
                                {isSuppExpanded && (
                                  <div className="overflow-x-auto">
                                  <table className="w-full text-sm min-w-[640px]">
                                    <thead>
                                      <tr className="bg-muted/20">
                                        <th className="py-1.5 px-4 pl-10 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                                        <th className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                                        <th className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                                        <th className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Store</th>
                                        <th className="py-1.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Payment</th>
                                        <th className="py-1.5 px-4 w-16" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...suppInvoices]
                                        .sort((a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? ""))
                                        .map(inv => {
                                        const store = stores.find(s => s.id === inv.storeId);
                                        const isAutoDebit = inv.supplier?.isAutoPay === true;
                                        return (
                                          <tr
                                            key={inv.id}
                                            className="border-t border-border/10 hover:bg-muted/20 transition-colors"
                                            data-testid={`row-invoice-${inv.id}`}
                                          >
                                            <td className="py-2.5 px-4 pl-10 text-muted-foreground whitespace-nowrap">{fmt(inv.invoiceDate)}</td>
                                            <td className="py-2.5 px-4 font-semibold tabular-nums text-right whitespace-nowrap">
                                              {fmtAUD(inv.amount ?? 0)}
                                              {/* §7 Wave 1 Day 5: GST estimate from supplier.defaultGstRate */}
                                              {(() => {
                                                const rate = inv.supplier?.defaultGstRate ?? 0;
                                                if (rate <= 0) return null;
                                                const est = Math.round(((inv.amount ?? 0) * rate / 100 / 11) * 100) / 100;
                                                return (
                                                  <div
                                                    className="text-[10px] font-normal text-muted-foreground/80"
                                                    title={`이 공급처는 기본으로 ${rate}%에 GST가 붙습니다 (추정치).`}
                                                  >
                                                    GST ~{fmtAUD(est)} ({rate}%)
                                                  </div>
                                                );
                                              })()}
                                            </td>
                                            <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{displayInvNumber(inv.invoiceNumber)} <DocBadge status={inv.docStatus} /></td>
                                            <td className="py-2.5 px-4 text-xs text-muted-foreground">{store?.name ?? "—"}</td>
                                            <td className="py-2.5 px-4">
                                              {isAutoDebit ? (
                                                <span
                                                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                                  data-testid={`badge-autopaid-${inv.id}`}
                                                >
                                                  <Zap className="h-2.5 w-2.5" />
                                                  자동이체로 지급
                                                </span>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">직접 지급</span>
                                              )}
                                            </td>
                                            <td className="py-2.5 pr-3 w-16">
                                              <div className="flex items-center gap-1 justify-end">
                                                {((inv.rawExtractedData as any)?.pdfBase64 || inv.notes) && (
                                                  <button
                                                    type="button"
                                                    title={(inv.rawExtractedData as any)?.pdfBase64 ? "PDF 인보이스 보기" : inv.notes}
                                                    className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${(inv.rawExtractedData as any)?.pdfBase64 ? "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                                                    data-testid={`button-notes-${inv.id}`}
                                                    onClick={(inv.rawExtractedData as any)?.pdfBase64 ? () => openInvoicePdf(inv.id) : undefined}
                                                  >
                                                    <FileText className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                                <button
                                                  type="button"
                                                  title="미지급으로 되돌리기 (예: 자동이체가 실패했을 때)"
                                                  onClick={() => setRevertInvoice(inv)}
                                                  className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground/40 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                                                  data-testid={`button-revert-${inv.id}`}
                                                >
                                                  <Undo2 className="h-3.5 w-3.5" />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )
        )}

        {/* ── CASH EXPENSES (§7 Wave 1 Day 4) ── */}
        {activeTab === "cashexpense" && (
          <CashExpenseReview storeFilter={storeFilter} />
        )}

        {/* ── EMAIL RULES ── */}
        {activeTab === "emailrules" && (
          rulesLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">메일 규칙 불러오는 중…</span>
            </div>
          ) : emailRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Mail className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">메일 규칙이 없습니다</p>
              <p className="text-xs">Review Inbox에서 보낸 사람을 승인하거나 무시하면 규칙이 만들어집니다.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]" data-testid="table-email-rules">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Email Address</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Supplier Name</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Action</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Created</th>
                      <th className="py-2.5 px-4 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {emailRules.map(rule => (
                      <tr
                        key={rule.email}
                        className="border-b border-border/10 last:border-0 hover:bg-muted/20 transition-colors"
                        data-testid={`row-rule-${rule.email}`}
                      >
                        <td className="py-2.5 px-4 font-mono text-xs" data-testid={`text-rule-email-${rule.email}`}>
                          {rule.email}
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground text-xs">
                          {rule.supplierName ?? "—"}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                              rule.action === "ALLOW" || rule.action === "ROUTE_TO_AP"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : rule.action === "ROUTE_TO_TODO"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                                : rule.action === "FYI_ARCHIVE"
                                ? "bg-muted text-muted-foreground"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                            }`}
                            data-testid={`text-rule-action-${rule.email}`}
                          >
                            {(rule.action === "ALLOW" || rule.action === "ROUTE_TO_AP") ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <Ban className="h-3 w-3" />
                            )}
                            {rule.action === "ROUTE_TO_AP" ? "인보이스로 처리"
                              : rule.action === "ROUTE_TO_TODO" ? "할 일로"
                              : rule.action === "FYI_ARCHIVE" ? "참고용 보관"
                              : rule.action === "SPAM_DROP" ? "스팸"
                              : rule.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {fmt(rule.createdAt?.toString())}
                        </td>
                        <td className="py-2.5 pr-4 w-10">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteRuleMutation.mutate(rule.email)}
                            disabled={deleteRuleMutation.isPending}
                            data-testid={`button-delete-rule-${rule.email}`}
                            title="규칙 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )
        )}

        {/* ── REJECTED (whitelist misses) ── */}
        {activeTab === "rejected" && <SupplierDomainAlerts />}
        {activeTab === "rejected" && (
          rejectedLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">거부된 메일 불러오는 중…</span>
            </div>
          ) : rejectedEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Mail className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">거부된 메일이 없습니다</p>
              <p className="text-xs">어느 공급처 연락처에도 없는 주소에서 온 메일이 여기에 나타납니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <RecoverOriginalsPanel />
              <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold">이게 뭔가요?</p>
                <p className="mt-0.5 opacity-90">
                  보낸 사람이 어느 공급처 연락처에도 없어서 입구에서 막힌 메일입니다.
                  진짜 공급처인데 등록을 깜빡한 경우라면 <strong>‘공급처에 추가…’</strong>를 누르세요.
                  그러면 앞으로 그 주소에서 오는 메일은 자동으로 통과합니다. 아니면 <strong>‘삭제’</strong>를 누르세요.
                </p>
              </div>
              <div className="space-y-2">
                {rejectedEmails.map(rej => (
                  <Card key={rej.id} data-testid={`row-rejected-${rej.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">
                              {rej.senderName || rej.senderEmail}
                            </span>
                            <span className="text-xs text-muted-foreground truncate" title={rej.senderEmail}>
                              &lt;{rej.senderEmail}&gt;
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {fmt(String(rej.receivedAt).split("T")[0])}
                            </span>
                            {rej.hasAttachment && (
                              <span className="text-[10px] rounded border border-blue-300/50 bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">
                                첨부 있음
                              </span>
                            )}
                          </div>
                          {rej.subject && (
                            <div className="text-xs text-muted-foreground truncate" title={rej.subject}>
                              <span className="opacity-70">제목:</span> {rej.subject}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={async () => {
                              const choice = window.prompt(
                                `"${rej.senderEmail}" 주소를 어느 공급처에 추가할까요?\n\n` +
                                `기존 공급처 이름의 일부를 입력하세요. 새 공급처를 만들려면 NEW: 뒤에 이름을 붙여 입력하세요 (예: NEW:공급처이름).\n\n` +
                                `기존 공급처: ${allSuppliersForPicker.map((s: any) => s.name).join(", ").slice(0, 400)}`
                              );
                              if (!choice) return;
                              let body: any;
                              if (choice.startsWith("NEW:")) {
                                body = { newSupplier: { name: choice.slice(4).trim() } };
                              } else {
                                const needle = choice.trim().toLowerCase();
                                const match = allSuppliersForPicker.find((s: any) => s.name.toLowerCase().includes(needle));
                                if (!match) {
                                  toast({ title: "맞는 공급처가 없습니다", description: `새 공급처를 만들려면 NEW:${choice} 라고 입력하세요.`, variant: "destructive" });
                                  return;
                                }
                                body = { existingSupplierId: match.id };
                              }
                              try {
                                const res = await apiRequest("POST", `/api/rejected-emails/${rej.id}/promote`, body);
                                const data = await res.json();
                                queryClient.invalidateQueries({ queryKey: ["/api/rejected-emails", "unreviewed"] });
                                queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
                                toast({ title: "공급처에 추가했습니다", description: `앞으로 ${rej.senderEmail}에서 오는 메일은 ${data.supplier?.name ?? "해당 공급처"}(으)로 들어갑니다.` });
                              } catch (e: any) {
                                toast({ title: "실패했습니다", description: e?.message ?? "다시 시도하세요.", variant: "destructive" });
                              }
                            }}
                            data-testid={`button-promote-${rej.id}`}
                            className="gap-1.5"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            공급처에 추가…
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await apiRequest("DELETE", `/api/rejected-emails/${rej.id}`);
                              queryClient.invalidateQueries({ queryKey: ["/api/rejected-emails", "unreviewed"] });
                              toast({ title: "삭제했습니다" });
                            }}
                            data-testid={`button-delete-rejected-${rej.id}`}
                            className="gap-1.5 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            삭제
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )
        )}

        {/* ── QUARANTINE ── */}
        {activeTab === "quarantine" && (
          quarantineLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">격리함 불러오는 중…</span>
            </div>
          ) : quarantinedInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <AlertCircle className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">격리된 인보이스가 없습니다</p>
              <p className="text-xs">자동으로 승인하지 못한 빈 건이나 중복 건이 여기에 나타납니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(() => {
                const alreadyHandled = quarantinedInvoices.filter(inv =>
                  /already exist|ignored by manager|duplicate/i.test(inv.notes ?? "")
                );
                return (
                  <div className="space-y-2">
                    <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-blue-800 dark:text-blue-200 min-w-0">
                        <strong>일괄 재분류</strong> — 검토함과 격리함에 멈춰 있는 건을 한 번에 4가지(인보이스 / 명세서 / 송금 확인서 / 기타)로 다시 나눕니다. PDF를 읽을 수 있는 인보이스는 To Pay로 옮기고, 송금 확인서·기타는 치웁니다.
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 shrink-0"
                        onClick={async () => {
                          if (!window.confirm("검토함·격리함에 멈춰 있는 인보이스를 모두 다시 분류할까요? PDF가 있는 인보이스는 To Pay로 옮기고, 송금 확인서(remittance)는 휴지통으로 보냅니다. 끝나면 결과 요약을 볼 수 있습니다.")) return;
                          try {
                            const res = await apiRequest("POST", "/api/invoices/bulk-reclassify", {});
                            const s = await res.json();
                            queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                            const reasons = s.reasons ? ` (PDF 없음: ${s.reasons.noPdf ?? 0}, 글자 없음: ${s.reasons.pdfTextEmpty ?? 0}, AI 결과 없음: ${s.reasons.aiReturnedNothing ?? 0}, 읽었지만 비어 있음: ${s.reasons.parsedButEmpty ?? 0}, 공급처 못 찾음: ${s.reasons.noSupplierMatch ?? 0})` : "";
                            const linked = (s.linkedByName ?? 0) + (s.linkedByEmail ?? 0);
                            const linkedDetail = linked > 0 ? ` · 공급처 자동 연결 ${linked}건 (이름으로 ${s.linkedByName ?? 0}, 이메일로 ${s.linkedByEmail ?? 0})` : "";
                            const dupDetail = s.duplicates > 0 ? ` · 중복 ${s.duplicates}건 자동 삭제` : "";
                            toast({
                              title: "재분류를 마쳤습니다",
                              description: `To Pay로 ${s.promoted}건 · 명세서에서 ${s.statementExpanded}건 · 버림 ${s.dropped}건${dupDetail} · 직접 처리 필요 ${s.needsManual}건${linkedDetail}${reasons} · 오류 ${s.errors}건.`,
                            });
                          } catch (e: any) {
                            toast({ title: "재분류에 실패했습니다", description: e?.message ?? "다시 시도하세요.", variant: "destructive" });
                          }
                        }}
                        data-testid="button-bulk-reclassify"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        멈춘 인보이스 모두 재분류
                      </Button>
                    </div>
                    <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                      <p className="font-semibold">정리하는 방법:</p>
                      <ul className="list-disc list-inside space-y-0.5 opacity-90">
                        <li><strong>‘이미 처리됨 → 삭제’ 표시가 붙은 줄</strong> → 그냥 ‘삭제’를 누르세요. 인보이스는 이미 Crew에 들어 있고, 이 줄은 남은 명세서나 중복입니다.</li>
                        <li><strong>PDF가 있고 금액이 분명한 줄</strong> → ‘다시 읽기’를 누르세요. 안 되면 (스캔한 PDF, 명세서 등) ‘PDF’로 열어 보고 ‘승인’을 눌러 금액을 직접 입력하세요.</li>
                        <li><strong>PDF가 없거나 진짜 인보이스가 아닌 줄</strong> → ‘삭제’.</li>
                      </ul>
                    </div>
                    {alreadyHandled.length > 0 && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-destructive min-w-0">
                          <strong>{alreadyHandled.length}</strong>건은 이미 다른 곳에서 처리되었습니다 (명세서/중복) — 한꺼번에 지워도 안전합니다.
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-destructive hover:text-destructive shrink-0"
                          onClick={async () => {
                            if (!window.confirm(`이미 처리된 격리 건 ${alreadyHandled.length}건을 삭제할까요? 휴지통으로 옮겨지며 다시 되살릴 수 있습니다.`)) return;
                            await Promise.all(alreadyHandled.map(inv =>
                              apiRequest("PATCH", `/api/supplier-invoices/${inv.id}/soft-delete`, {})
                            ));
                            queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
                            toast({ title: `${alreadyHandled.length}건을 휴지통으로 옮겼습니다` });
                          }}
                          data-testid="button-bulk-delete-handled"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {alreadyHandled.length}건 모두 삭제
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Card-style list — never gets horizontally clipped */}
              <div className="space-y-2">
                {quarantinedInvoices.map(inv => {
                  const enrichedInv = inv as any;
                  const raw = enrichedInv.rawExtractedData as any;
                  const senderEmail = raw?.senderEmail ?? null;
                  const subject = raw?.subject ?? null;
                  const hasPdf = !!raw?.pdfBase64;
                  const hasAmount = (inv.amount ?? 0) > 0;
                  // Statement/duplicate/ignored rows: the underlying invoice(s)
                  // are already in the system — this row is leftover noise.
                  const alreadyHandled = /already exist|ignored by manager|duplicate/i.test(inv.notes ?? "");
                  // Try to extract an invoice number hint from the subject
                  // ("INV-1234", "Invoice 5678", etc.) when the row's own
                  // invoice_number is still the TRIAGE-/EMAIL- placeholder.
                  const invNumGuess = (() => {
                    if (inv.invoiceNumber && !/^(TRIAGE-|EMAIL-)/.test(inv.invoiceNumber)) return inv.invoiceNumber;
                    const hay = `${subject ?? ""} ${inv.notes ?? ""}`;
                    const m = hay.match(/\b(?:INV[- ]?|Invoice[- #]?)(\d{3,10})\b/i);
                    return m ? `INV-${m[1]}` : null;
                  })();
                  const supplierLabel = enrichedInv.supplier?.name ?? (senderEmail ? senderEmail.split("@")[1] ?? senderEmail : "모르는 공급처");

                  return (
                    <Card key={inv.id} className={`overflow-hidden ${alreadyHandled ? "border-destructive/30 bg-destructive/[0.02]" : ""}`} data-testid={`row-quarantine-${inv.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          {/* Left: metadata */}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm truncate">{supplierLabel}</span>
                              {invNumGuess && (
                                <span className="font-mono text-xs text-muted-foreground">#{invNumGuess}</span>
                              )}
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {fmt(inv.invoiceDate)}
                              </span>
                              <span className={`font-semibold tabular-nums text-sm ${hasAmount ? "text-foreground" : "text-muted-foreground"}`}>
                                {fmtAUD(inv.amount ?? 0)}
                              </span>
                              {alreadyHandled && (
                                <span className="text-[10px] rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive font-semibold">
                                  이미 처리됨 → 삭제
                                </span>
                              )}
                              {!alreadyHandled && !hasAmount && (
                                <span className="text-[10px] rounded border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 text-amber-800 dark:text-amber-300">
                                  AI가 금액을 못 읽음
                                </span>
                              )}
                              {!hasPdf && (
                                <span className="text-[10px] rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-destructive">
                                  PDF 없음
                                </span>
                              )}
                            </div>
                            {senderEmail && enrichedInv.supplier?.name && (
                              <div className="text-[11px] text-muted-foreground truncate" title={senderEmail}>
                                보낸 곳: {senderEmail}
                              </div>
                            )}
                            {subject && (
                              <div className="text-xs text-muted-foreground truncate" title={subject}>
                                <span className="opacity-70">제목:</span> {subject}
                              </div>
                            )}
                            {inv.notes && (
                              <div className="text-[11px] text-muted-foreground/80 truncate" title={inv.notes}>
                                {inv.notes}
                              </div>
                            )}
                          </div>

                          {/* Right: actions */}
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            {hasPdf && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openInvoicePdf(inv.id)}
                                data-testid={`button-quarantine-pdf-${inv.id}`}
                                className="gap-1.5"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                PDF
                              </Button>
                            )}
                            {hasPdf && !hasAmount && !alreadyHandled && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const res = await apiRequest("POST", `/api/supplier-invoices/${inv.id}/reparse-pdf`, {});
                                    const body = await res.json().catch(() => ({}));
                                    queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                                    toast({ title: "PDF를 다시 읽었습니다", description: body?.supplier?.supplierName ? `공급처: ${body.supplier.supplierName}. 금액을 확인한 뒤 ‘승인’을 누르세요.` : "금액을 확인한 뒤 ‘승인’을 누르세요." });
                                  } catch (e: any) {
                                    const errMsg = String(e?.message ?? "");
                                    const is422 = errMsg.includes("422") || /no invoices/i.test(errMsg);
                                    toast({
                                      title: "다시 읽기에 실패했습니다",
                                      description: is422
                                        ? "이 PDF에는 인보이스가 한 건씩 들어 있지 않습니다 (아마 명세서). ‘삭제’하세요 — 진짜 인보이스는 이미 Crew에 있습니다."
                                        : "글자를 읽지 못했습니다 (스캔한/사진 PDF). PDF를 열어 보고 금액을 직접 입력하세요.",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                data-testid={`button-reparse-quarantine-${inv.id}`}
                                className="gap-1.5"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                다시 읽기
                              </Button>
                            )}
                            {!alreadyHandled && (
                              <Button
                                size="sm"
                                variant={hasAmount ? "default" : "outline"}
                                onClick={async () => {
                                  if (!inv.amount || inv.amount <= 0) {
                                    const raw = window.prompt("인보이스 금액(AUD)을 입력하세요 — 먼저 PDF를 확인하세요:");
                                    const amt = raw ? Number(raw) : NaN;
                                    if (!raw || isNaN(amt) || amt <= 0) return;
                                    await apiRequest("PATCH", `/api/supplier-invoices/${inv.id}`, { amount: amt });
                                  }
                                  await apiRequest("PATCH", `/api/invoices/${inv.id}/status`, { status: "PENDING" });
                                  queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                                  queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                                  toast({ title: "To Pay로 옮겼습니다" });
                                }}
                                data-testid={`button-approve-quarantine-${inv.id}`}
                                className="gap-1.5"
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                승인
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={alreadyHandled ? "default" : "outline"}
                              onClick={async () => {
                                await apiRequest("PATCH", `/api/supplier-invoices/${inv.id}/soft-delete`, {});
                                queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/quarantined"] });
                                queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
                                toast({ title: "휴지통으로 옮겼습니다" });
                              }}
                              data-testid={`button-delete-quarantine-${inv.id}`}
                              className={alreadyHandled ? "gap-1.5" : "gap-1.5 text-destructive hover:text-destructive"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              삭제
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* ── TRASH ── */}
        {activeTab === "trash" && (
          trashLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">휴지통 불러오는 중…</span>
            </div>
          ) : deletedInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Trash2 className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">휴지통이 비어 있습니다</p>
              <p className="text-xs">삭제한 인보이스가 여기에 나타나며, 다시 되살릴 수 있습니다.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Supplier</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Was</th>
                      <th className="w-48 py-2.5 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {deletedInvoices.map(inv => {
                      const enrichedInv = inv as any;
                      const isRestoring = restoreInvoiceMutation.isPending && restoreInvoiceMutation.variables === inv.id;
                      const isDeleting = permanentDeleteMutation.isPending && permanentDeleteMutation.variables === inv.id;
                      return (
                        <tr key={inv.id} className="border-b border-border/10 last:border-0 hover:bg-muted/20 transition-colors" data-testid={`row-trash-${inv.id}`}>
                          <td className="py-2.5 px-4 font-medium">
                            {enrichedInv.supplier?.name ?? enrichedInv.rawExtractedData?.supplier?.supplierName ?? "Unknown Supplier"}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">
                            {displayInvNumber(inv.invoiceNumber)}
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                            {fmt(inv.invoiceDate)}
                          </td>
                          <td className="py-2.5 px-4 font-semibold tabular-nums text-right whitespace-nowrap">
                            {fmtAUD(inv.amount ?? 0)}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                              {inv.previousStatus ?? "PENDING"}
                            </span>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => restoreInvoiceMutation.mutate(inv.id)}
                                disabled={isRestoring || isDeleting}
                                data-testid={`button-restore-${inv.id}`}
                                className="gap-1.5"
                              >
                                {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                                되살리기
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => permanentDeleteMutation.mutate(inv.id)}
                                disabled={isRestoring || isDeleting}
                                data-testid={`button-permanent-delete-${inv.id}`}
                                className="gap-1.5 text-destructive hover:text-destructive"
                              >
                                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                영구 삭제
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )
        )}
      </div>

      {/* ── Revert Confirmation Dialog ─────────────────────────────────────── */}
      <AlertDialog open={!!revertInvoice} onOpenChange={open => !open && setRevertInvoice(null)}>
        <AlertDialogContent data-testid="dialog-revert-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>인보이스를 미지급으로 되돌릴까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{revertInvoice?.supplier?.name ?? "이 인보이스"}</strong>{" "}
              {displayInvNumber(revertInvoice?.invoiceNumber) !== "—" ? `(#${revertInvoice?.invoiceNumber})` : ""}을(를){" "}
              <strong>To Pay</strong> 목록으로 되돌리고, 지급 기록은 완전히 지웁니다.
              {revertInvoice?.supplier?.isAutoPay && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  이 공급처는 자동이체를 씁니다. 자동이체가 실패했거나 반송됐을 때만 되돌리세요.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-revert-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revertInvoice && revertMutation.mutate(revertInvoice.id)}
              disabled={revertMutation.isPending}
              className="bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600"
              data-testid="button-revert-confirm"
            >
              {revertMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />되돌리는 중…</>
              ) : (
                <><Undo2 className="h-3.5 w-3.5 mr-1.5" />미지급으로 되돌리기</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Email View Dialog ─────────────────────────────────────────────────── */}
      {viewEmailInvoice && (() => {
        const raw = viewEmailInvoice.rawExtractedData as ReviewRawData | null;
        const emailInfo = parseNotesEmailInfo(viewEmailInvoice.notes);
        const from = raw?.senderEmail || emailInfo.from || "—";
        const subject = raw?.subject || emailInfo.subject || "—";
        const emailBody = raw?.body || "";
        const systemNotes = viewEmailInvoice.notes || "";
        const hasPdf = !!(raw as any)?.pdfBase64;

        return (
          <Dialog open={!!viewEmailInvoice} onOpenChange={open => !open && setViewEmailInvoice(null)}>
            <DialogContent
              className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0"
              data-testid="dialog-view-email"
            >
              {/* Header */}
              <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40 shrink-0">
                <div className="flex items-start justify-between gap-3 pr-6">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <DialogTitle className="text-base leading-snug">{subject}</DialogTitle>
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      <span><span className="text-foreground/50 w-14 inline-block">보낸 사람:</span> {from}</span>
                      {displayInvNumber(viewEmailInvoice.invoiceNumber) !== "—" && (
                        <span><span className="text-foreground/50 w-14 inline-block">인보이스:</span> {viewEmailInvoice.invoiceNumber}</span>
                      )}
                      {viewEmailInvoice.createdAt && (
                        <span><span className="text-foreground/50 w-14 inline-block">받은 시각:</span> {new Date(viewEmailInvoice.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span>
                      )}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Body */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Actual email body */}
                {emailBody ? (() => {
                  const isHtml = /<\s*(html|body|div|table|p|span|br|a|img|style)\b/i.test(emailBody);
                  if (isHtml) {
                    return (
                      <iframe
                        srcDoc={emailBody}
                        sandbox="allow-same-origin"
                        title="이메일 내용"
                        className="w-full border-0"
                        style={{ minHeight: "300px", height: "300px" }}
                        onLoad={e => {
                          try {
                            const frame = e.currentTarget;
                            const doc = frame.contentDocument || frame.contentWindow?.document;
                            if (doc) {
                              const h = doc.documentElement.scrollHeight;
                              frame.style.height = Math.min(Math.max(h, 200), 500) + "px";
                            }
                          } catch { /* cross-origin blocked — use fixed height */ }
                        }}
                      />
                    );
                  }
                  return (
                    <div className="px-5 py-4">
                      <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed break-words">
                        {emailBody}
                      </pre>
                    </div>
                  );
                })() : (
                  <div className="px-5 py-4">
                    <p className="text-sm text-muted-foreground italic">이 인보이스에는 저장된 이메일 본문이 없습니다.</p>
                  </div>
                )}

                {/* System notes — always shown separately */}
                {systemNotes && (
                  <div className={`px-5 py-3 bg-muted/20 ${emailBody ? "border-t border-border/30" : ""}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">시스템 메모</p>
                    <pre className="text-xs text-foreground/70 whitespace-pre-wrap font-sans leading-relaxed break-words">
                      {systemNotes}
                    </pre>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border/40 shrink-0 bg-muted/10">
                <div className="flex items-center gap-2">
                  {hasPdf && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openInvoicePdf(viewEmailInvoice.id)}
                      data-testid="button-view-email-pdf"
                      className="gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      PDF 보기
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewEmailInvoice(null)}
                    data-testid="button-close-view-email"
                  >
                    닫기
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setViewEmailInvoice(null);
                      setApproveInvoiceGroup([viewEmailInvoice]);
                    }}
                    data-testid="button-view-email-approve"
                    className="gap-1.5"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    승인하고 공급처 추가
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Bulk Delete Confirmation Dialog ───────────────────────────────────── */}
      {/* The selection survives store-tab switches (owner builds a batch over several visits), so
          before paying show every selected invoice by store — a Sandwich pick must not ride along unseen. */}
      <AlertDialog open={payConfirmOpen} onOpenChange={open => !open && setPayConfirmOpen(false)}>
        <AlertDialogContent data-testid="dialog-bulk-pay-confirm">
          {(() => {
            const picked = toPayInvoices.filter(inv => selected.has(inv.id));
            const byStore = new Map<string, { count: number; total: number }>();
            for (const inv of picked) {
              const name = stores.find(st => st.id === inv.storeId)?.name ?? "매장 미지정";
              const e = byStore.get(name) ?? { count: 0, total: 0 };
              e.count++; e.total += inv.amount ?? 0; byStore.set(name, e);
            }
            const hidden = hiddenSelectedCount;
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>인보이스 {picked.length}건을 지급 완료로 표시할까요?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      <table className="w-full">
                        <tbody>
                          {Array.from(byStore.entries()).map(([name, e]) => (
                            <tr key={name} className="border-t"><td className="py-1 font-medium">{name}</td><td className="py-1 text-right">{e.count}건</td><td className="py-1 text-right tabular-nums">{fmtAUD(e.total)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      {hidden > 0 && (
                        <p className="rounded bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 px-2 py-1.5">
                          다른 매장 탭에서 선택해 둔 <strong>{hidden}건</strong>은 이번에 처리하지 않고 선택된 채로 둡니다. 그 탭에서 따로 지급하세요.
                        </p>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkMarkPaidMutation.isPending} data-testid="button-bulk-pay-cancel">취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => { bulkMarkPaidMutation.mutate(picked.map(inv => inv.id)); setPayConfirmOpen(false); }}
                    disabled={bulkMarkPaidMutation.isPending}
                    data-testid="button-bulk-pay-confirm"
                  >
                    지급 완료로 표시 ({picked.length})
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={open => !open && setBulkDeleteConfirmOpen(false)}>
        <AlertDialogContent data-testid="dialog-bulk-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>휴지통으로 옮길까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 탭에서 선택한 인보이스 {visibleSelectedIds.length}건을 휴지통으로 옮깁니다.{hiddenSelectedCount > 0 ? ` 다른 매장 탭에서 선택한 ${hiddenSelectedCount}건은 그대로 둡니다.` : ""}
              필요하면 <strong>Trash</strong> 탭(휴지통)에서 되살릴 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={bulkSoftDeleteMutation.isPending}
              data-testid="button-bulk-delete-cancel"
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkSoftDeleteMutation.mutate(visibleSelectedIds)}
              disabled={bulkSoftDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-bulk-delete-confirm"
            >
              {bulkSoftDeleteMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />삭제 중…</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5 mr-1.5" />휴지통으로 이동</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddInvoiceModal
        open={addInvoiceOpen}
        onClose={() => setAddInvoiceOpen(false)}
      />

      <ApproveSupplierModal
        invoices={approveInvoiceGroup}
        onClose={() => setApproveInvoiceGroup([])}
        onSuccess={() => setApproveInvoiceGroup([])}
      />

      <ReassignSupplierDialog
        invoice={reassignInvoice}
        onClose={() => setReassignInvoice(null)}
        onSuccess={() => {
          setReassignInvoice(null);
          queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
          queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
        }}
      />
    </AdminLayout>
  );
}

type RecoverRow = { rejectedId: string; supplier: string; number?: string; action: string; amount?: number | null; status?: string; store?: string | null; dueDate?: string | null };
type RecoverResult = { apply: boolean; rows: RecoverRow[]; summary: Record<string, { count: number; amount: number }> };

// Rejected inbox → recover invoice originals from senders that are whitelisted now.
// Always previews first (read-only); nothing is written until the owner confirms.
function RecoverOriginalsPanel() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<RecoverResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const run = async (apply: boolean): Promise<RecoverResult> => {
    const res = await apiRequest("POST", "/api/invoices/recover-rejected-originals", { apply });
    return res.json();
  };
  const s = preview?.summary ?? {};
  const attach = s.attach ?? { count: 0, amount: 0 };
  const create = s.create ?? { count: 0, amount: 0 };
  const skipped = Object.entries(s).filter(([k]) => k !== "attach" && k !== "create");
  const creates = preview?.rows.filter(r => r.action === "create") ?? [];
  const attachNoAmount = preview?.rows.filter(r => r.action === "attach" && !(r as any).amountInPdf).length ?? 0;

  return (
    <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-center justify-between gap-3">
      <div className="text-xs text-blue-800 dark:text-blue-200 min-w-0">
        <strong>원본 회수</strong> — 보낸 사람이 공급처에 등록되기 전에 여기로 들어온 인보이스입니다.
        원본 PDF를 맞는 기록에 붙이고 (금액·지급 상태는 그대로), 아직 장부에 없는 인보이스는 To Pay에 추가합니다. 실행 전에 숫자를 먼저 보여 드립니다.
      </div>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 shrink-0"
        disabled={busy !== null}
        onClick={async () => {
          setBusy("preview");
          try { setPreview(await run(false)); }
          catch (e: any) { toast({ title: "미리보기에 실패했습니다", description: e?.message ?? "다시 시도하세요.", variant: "destructive" }); }
          finally { setBusy(null); }
        }}
        data-testid="button-recover-originals"
      >
        {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        원본 회수…
      </Button>

      <AlertDialog open={preview !== null} onOpenChange={(o) => { if (!o && busy === null) setPreview(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>인보이스 원본 회수</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>기존 기록 <strong>{attach.count}</strong>건에 원본 PDF를 붙입니다 ({fmtAUD(attach.amount)}). 금액과 지급 상태는 그대로입니다.</p>
                {attachNoAmount > 0 && <p className="text-amber-700 dark:text-amber-300">이 중 {attachNoAmount}건은 기록된 금액이 PDF에 보이지 않습니다 — 나중에 확인하세요.</p>}
                <p>새 인보이스 <strong>{create.count}</strong>건을 To Pay에 추가합니다 ({fmtAUD(create.amount)}):</p>
                {creates.length > 0 && (
                  <ul className="list-disc list-inside text-xs">
                    {creates.map(r => <li key={r.rejectedId}>{r.supplier} · {r.number} · {fmtAUD(r.amount ?? 0)}{r.dueDate ? ` · 기한 ${fmt(r.dueDate)}` : ""}{r.store ? ` · ${r.store}` : " · 매장 미지정"}</li>)}
                  </ul>
                )}
                {skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground">건너뜀: {skipped.map(([k, v]) => `${k.replace(/^skip_/, "").replace(/_/g, " ")} ${v.count}`).join(" · ")}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null || attach.count + create.count === 0}
              onClick={async (e) => {
                e.preventDefault();
                setBusy("apply");
                try {
                  const done = await run(true);
                  queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/rejected-emails", "unreviewed"] });
                  toast({ title: "원본을 회수했습니다", description: `PDF 붙임 ${done.summary.attach?.count ?? 0}건 · To Pay에 추가 ${done.summary.create?.count ?? 0}건.` });
                  setPreview(null);
                } catch (err: any) {
                  toast({ title: "원본 회수에 실패했습니다", description: err?.message ?? "다시 시도하세요.", variant: "destructive" });
                } finally { setBusy(null); }
              }}
              data-testid="button-recover-originals-confirm"
            >
              {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              {attach.count}건 붙이기 · {create.count}건 추가
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


// PLAN 1-4: records without their own invoice document (tax records are kept 5 years).
// ORIGINAL shows nothing; only the gaps are flagged.
function DocBadge({ status }: { status?: DocStatus | null }) {
  if (status === "STATEMENT_ONLY") return (
    <span title="원본 인보이스가 없습니다 — 공급처 명세서만 이 기록의 근거입니다." className="ml-1 inline-block rounded px-1 py-px text-[10px] font-sans font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">명세서만</span>
  );
  if (status === "NONE") return (
    <span title="이 기록에는 보관된 서류가 없습니다." className="ml-1 inline-block rounded px-1 py-px text-[10px] font-sans font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">서류 없음</span>
  );
  return null;
}

function DocStatusSummary({ invoices }: { invoices: EnrichedInvoice[] }) {
  const live = invoices.filter(i => i.status !== "DELETED" && i.docStatus);
  if (live.length === 0) return null;
  const n = (k: DocStatus) => live.filter(i => i.docStatus === k).length;
  return (
    <div className="mb-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
      <strong className="text-foreground">인보이스 서류</strong> — 원본 있음 {n("ORIGINAL")}건
      {" · "}<span className="text-amber-700 dark:text-amber-300">명세서만 {n("STATEMENT_ONLY")}건</span>
      {" · "}<span className="text-red-700 dark:text-red-300">서류 없음 {n("NONE")}건</span>
      <span className="opacity-80"> — 세금 관련 서류는 5년간 보관해야 합니다. 표시된 건은 공급처에 사본을 요청하세요.</span>
    </div>
  );
}


type ReconIssue = {
  type: "AMOUNT_DIFF" | "MISSING_IN_LEDGER" | "LEDGER_ONLY" | "PAID_BEFORE_STATEMENT" | "STATEMENT_SHOWS_PAID";
  supplierId: string; invoiceNumber: string; invoiceId: string | null; statementId: string; statementDate: string | null;
  statementAmount: number | null; ledgerAmount: number | null; ledgerStatus: string | null; paidOn: string | null;
};
type ReconSupplier = {
  supplierId: string; supplierName: string; statements: number; latestStatementId: string; latestStatementDate: string | null;
  closingBalance: number | null; storeName: string | null; storeUnknown: boolean; ledgerUnpaidAsOf: number | null;
  invoicesOnStatements: number; matched: number;
};

const RECON_LABEL: Record<ReconIssue["type"], { label: string; hint: string }> = {
  STATEMENT_SHOWS_PAID: { label: "공급처는 지급 완료로 표시", hint: "명세서에는 지급된 것으로 나오는데 Crew에는 아직 미지급입니다 — 실제로 돈이 나갔다면 지급 완료로 표시하세요." },
  PAID_BEFORE_STATEMENT: { label: "지급했는데 아직 미납으로 나옴", hint: "명세서 날짜 전에 Crew에서 지급 완료로 표시했는데, 명세서에는 아직 남아 있습니다 — 돈이 공급처에 잘 들어갔는지 확인하세요." },
  MISSING_IN_LEDGER: { label: "Crew에 없음", hint: "공급처는 청구했는데 Crew에는 기록이 없습니다 — 인보이스가 아예 안 들어왔을 수 있습니다." },
  AMOUNT_DIFF: { label: "금액이 다름", hint: "명세서와 Crew의 금액이 다릅니다 — 크레딧(차감)이 있었거나 입력 실수일 수 있습니다." },
  LEDGER_ONLY: { label: "Crew에만 있음", hint: "Crew에는 기록됐는데 그 기간의 공급처 명세서에는 없습니다 — 중복이거나, 공급처나 매장이 잘못 지정됐을 수 있습니다." },
};

// PLAN 1-6: statements ↔ ledger. Read-only: nothing here changes an invoice.
function StatementsTab() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<{ suppliers: ReconSupplier[]; issues: ReconIssue[] }>({
    queryKey: ["/api/statements/reconciliation"],
  });
  const openPdf = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e: any) {
      toast({ title: "PDF를 열 수 없습니다", description: e?.message ?? "네트워크 오류", variant: "destructive" });
    }
  };
  if (isLoading) return <div className="flex items-center justify-center h-48 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">명세서 확인 중…</span></div>;
  if (error || !data) return <p className="text-sm text-destructive">명세서 확인 결과를 불러오지 못했습니다.</p>;
  const name = new Map(data.suppliers.map(s => [s.supplierId, s.supplierName]));
  const types = (Object.keys(RECON_LABEL) as ReconIssue["type"][]).filter(t => data.issues.some(i => i.type === t));

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        공급처 명세서를 하나씩 Crew 기록과 비교합니다. 여기서는 인보이스가 바뀌지 않습니다 — 표시된 건은 To Pay나 Paid History에서 고치세요.
        줄별 금액의 합이 명세서에 적힌 잔액과 맞는 명세서만 비교합니다. 다른 공급처는 먼저 명세서 규칙이 필요합니다.
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-2 px-3">Supplier</th><th className="py-2 px-3">Latest statement</th>
              <th className="py-2 px-3 text-right">Statement balance</th><th className="py-2 px-3 text-right">Unpaid in Crew then</th>
              <th className="py-2 px-3 text-right">Invoices matched</th><th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map(s => (
              <tr key={s.supplierId} className="border-t">
                <td className="py-2 px-3">{s.supplierName}{s.storeName ? <span className="text-muted-foreground"> · {s.storeName}</span> : null}</td>
                <td className="py-2 px-3 whitespace-nowrap">{s.latestStatementDate ? fmt(s.latestStatementDate) : "—"} <span className="text-xs text-muted-foreground">({s.statements})</span></td>
                <td className="py-2 px-3 text-right font-mono">{s.closingBalance != null ? fmtAUD(s.closingBalance) : "—"}</td>
                <td className="py-2 px-3 text-right font-mono" title="명세서 날짜까지의 인보이스 중, 그때까지 Crew에서 지급 완료로 표시하지 않은 금액입니다. Crew에 지급 표시를 늦게 하면 이 금액이 커집니다.">
                  {s.storeUnknown ? <span className="text-xs text-amber-700 dark:text-amber-300 font-sans">비교하려면 매장 별칭을 추가하세요</span> : s.ledgerUnpaidAsOf != null ? fmtAUD(s.ledgerUnpaidAsOf) : "—"}
                </td>
                <td className="py-2 px-3 text-right">{s.matched}/{s.invoicesOnStatements}</td>
                <td className="py-2 px-3 text-right">
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => openPdf(`/api/statements/${s.latestStatementId}/pdf`)} data-testid={`button-statement-pdf-${s.supplierId}`}>
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {types.length === 0 ? (
        <p className="text-sm text-muted-foreground">다른 점이 없습니다.</p>
      ) : types.map(t => {
        const rows = data.issues.filter(i => i.type === t);
        return (
          <div key={t} className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30">
              <p className="text-sm font-medium">{RECON_LABEL[t].label} <span className="text-muted-foreground">({rows.length})</span></p>
              <p className="text-xs text-muted-foreground">{RECON_LABEL[t].hint}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1.5 px-3">Supplier</th><th className="py-1.5 px-3">Invoice #</th><th className="py-1.5 px-3">Statement</th>
                  <th className="py-1.5 px-3 text-right">On statement</th><th className="py-1.5 px-3 text-right">In Crew</th><th className="py-1.5 px-3">Crew status</th><th className="py-1.5 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i, n) => (
                  <tr key={`${i.statementId}-${i.invoiceNumber}-${n}`} className="border-t">
                    <td className="py-1.5 px-3">{name.get(i.supplierId) ?? "—"}</td>
                    <td className="py-1.5 px-3 font-mono text-xs">{displayInvNumber(i.invoiceNumber)}</td>
                    <td className="py-1.5 px-3 whitespace-nowrap">{i.statementDate ? fmt(i.statementDate) : "—"}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{i.statementAmount != null ? fmtAUD(i.statementAmount) : "—"}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{i.ledgerAmount != null ? fmtAUD(i.ledgerAmount) : "—"}</td>
                    <td className="py-1.5 px-3 text-xs">{i.ledgerStatus ? `${i.ledgerStatus}${i.paidOn ? ` · ${fmt(i.paidOn)}` : ""}` : "—"}</td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openPdf(`/api/statements/${i.statementId}/pdf`)}>명세서</Button>
                      {i.invoiceId && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openPdf(`/api/supplier-invoices/${i.invoiceId}/pdf`)}>인보이스</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}


type LinkedPdfRow = { id: string; supplier: string; invoiceNumber: string; amount: number; action: string; checkedBy?: "pdf" | "email"; store?: string | null; hadStore?: boolean };

// Invoices that arrived as a download link in the email body (no PDF kept).
function LinkedPdfPanel() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<LinkedPdfRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, refetch } = useQuery<{ count: number }>({ queryKey: ["/api/invoices/linked-pdf/backfill"] });
  if (!data?.count) return null;
  const run = async (apply: boolean) => (await apiRequest("POST", "/api/invoices/linked-pdf/backfill", { apply })).json();
  const ok = preview?.filter(r => r.action === "attach") ?? [];
  return (
    <div className="mb-3 rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-center justify-between gap-3">
      <div className="text-xs text-blue-800 dark:text-blue-200 min-w-0">
        <strong>인보이스 {data.count}건이 다운로드 링크로만 왔습니다</strong> — PDF가 저장되지 않았습니다. 받아 두면 원본이 보관되고, 매장도 PDF의 ‘Bill To’(청구처)에서 읽어 옵니다.
      </div>
      <Button size="sm" variant="outline" className="gap-1.5 shrink-0" disabled={busy}
        onClick={async () => { setBusy(true); try { setPreview((await run(false)).rows); } catch (e: any) { toast({ title: "미리보기에 실패했습니다", description: e?.message ?? "다시 시도하세요.", variant: "destructive" }); } finally { setBusy(false); } }}
        data-testid="button-linked-pdf-preview">
        {busy && !preview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        PDF 받기…
      </Button>
      <AlertDialog open={preview !== null} onOpenChange={(o) => { if (!o && !busy) setPreview(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>링크로 온 인보이스 PDF 받기</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>PDF {preview?.length ?? 0}건 중 <strong>{ok.length}</strong>건을 받아서 맞는 기록에 연결했습니다 (PDF의 금액으로 확인, 사진으로만 된 PDF는 이메일에 적힌 번호와 금액으로 확인). 금액과 지급 상태는 바뀌지 않습니다.</p>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground"><th>Supplier</th><th>Invoice #</th><th className="text-right">Amount</th><th>Result</th></tr></thead>
                  <tbody>
                    {(preview ?? []).map(r => (
                      <tr key={r.id}>
                        <td>{r.supplier}</td><td className="font-mono">{r.invoiceNumber}</td><td className="text-right">{fmtAUD(r.amount)}</td>
                        <td>{r.action === "attach"
                          ? `붙이기${r.checkedBy === "email" ? " (사진 PDF, 이메일로 확인)" : ""}${r.store ? ` · 매장 → ${r.store}` : r.hadStore ? "" : " · 매장은 직접 지정하세요"}`
                          : r.action === "link_unavailable" ? "링크가 더 이상 열리지 않음"
                          : r.action === "image_pdf_body_mismatch" ? "사진 PDF, 이메일 내용과 안 맞음" : "PDF에 금액이 없음"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction disabled={busy || ok.length === 0}
              onClick={async (e) => {
                e.preventDefault(); setBusy(true);
                try {
                  const r = await run(true);
                  queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
                  await refetch();
                  toast({ title: "PDF를 붙였습니다", description: `인보이스 ${r.rows.filter((x: LinkedPdfRow) => x.action === "attach").length}건에 PDF가 생겼습니다.` });
                  setPreview(null);
                } catch (err: any) {
                  toast({ title: "실패했습니다", description: err?.message ?? "다시 시도하세요.", variant: "destructive" });
                } finally { setBusy(false); }
              }}
              data-testid="button-linked-pdf-confirm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              PDF {ok.length}건 붙이기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type DomainAlert = { supplier_id: string; supplier_name: string; sender_email: string; n: number; last_at: string; last_subject: string | null };

// A known supplier's company address sending PDFs that the whitelist blocked.
function SupplierDomainAlerts() {
  const { data } = useQuery<DomainAlert[]>({ queryKey: ["/api/rejected-emails/supplier-domain-alerts"] });
  if (!data?.length) return null;
  return (
    <div className="mb-3 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-800 dark:text-red-200 space-y-1.5">
      <p className="font-semibold">막힌 인보이스가 있을 수 있습니다 — 이미 등록된 공급처 회사의 다른 주소에서 온 메일입니다</p>
      <ul className="space-y-1">
        {data.map(a => (
          <li key={a.sender_email}>
            <span className="font-mono">{a.sender_email}</span> → <strong>{a.supplier_name}</strong>: PDF가 붙은 메일 {a.n}통, 마지막 {fmtReceived(a.last_at)}
            {a.last_subject ? <span className="opacity-80"> — “{a.last_subject.slice(0, 80)}”</span> : null}
          </li>
        ))}
      </ul>
      <p className="opacity-90">인보이스가 맞다면: 아래 메일 중 하나에서 <strong>‘공급처에 추가…’</strong>를 누른 다음, <strong>‘원본 회수…’</strong>를 눌러 막힌 메일을 가져오세요.</p>
    </div>
  );
}

// Mail read straight from the owner's Gmail (Cloudmailin's free plan drops anything over 512 KB).
type GmailStatus = { configured: boolean; connected: boolean; email: string | null; lastPollAt: string | null; lastError: string | null; delivered: number };
type GmailBackfill = { since: string; apply: boolean; scanned: number; summary: Record<string, Record<string, number>>; rows: Array<{ supplier: string; subject: string; date: string; action: string; number?: string | null; error?: string }> };
const GMAIL_ACTION_KO: Record<string, string> = { to_deliver: "가져올 메일", delivered: "가져옴", in_ledger: "이미 장부에 있음", already_seen: "이미 받음", failed: "실패" };
function GmailInboxPanel() {
  const { toast } = useToast();
  const { data: st, refetch } = useQuery<GmailStatus>({ queryKey: ["/api/gmail/status"], refetchInterval: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [bf, setBf] = useState<GmailBackfill | null>(null);
  const [since, setSince] = useState("2026-05-01");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get("gmail");
    if (!g) return;
    if (g === "connected") toast({ title: "Gmail을 연결했습니다", description: q.get("email") ?? undefined });
    else toast({ title: "Gmail 연결에 실패했습니다", description: q.get("reason") ?? (g === "denied" ? "허용하지 않으셨습니다" : undefined), variant: "destructive" });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  if (!st) return null;
  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try { return await fn(); } catch (e: any) { toast({ title: "실패했습니다", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); refetch(); }
  };
  const when = (d: string | null) => (d ? new Date(d).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const toDeliver = bf ? bf.rows.filter(r => r.action === "to_deliver").length : 0;

  return (
    <div className={`rounded-md border p-3 space-y-2 ${st.connected && !st.lastError ? "border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/20" : "border-amber-300/60 bg-amber-50 dark:bg-amber-950/20"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs min-w-0">
          <strong>Gmail 직접 받기</strong>{" "}
          {!st.configured ? "— 서버에 Google 연결 정보(GOOGLE_CLIENT_ID / SECRET)가 없습니다."
            : !st.connected ? "— 아직 연결되지 않았습니다. 연결하면 accounts@ 메일과 등록된 공급처 메일을 5분마다 직접 가져옵니다 (읽기 전용)."
            : <>— {st.email} 연결됨 · 마지막 확인 {when(st.lastPollAt)} · 지금까지 가져온 메일 {st.delivered}통</>}
          {st.lastError && <p className="text-destructive mt-1">문제: {st.lastError}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {st.configured && !st.connected && (
            <Button size="sm" disabled={!!busy} data-testid="button-gmail-connect"
              onClick={() => act("connect", async () => { const r = await (await apiRequest("POST", "/api/gmail/connect")).json(); window.location.href = r.url; })}>
              {busy === "connect" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Gmail 연결
            </Button>
          )}
          {st.connected && <>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("poll", async () => { const r = await (await apiRequest("POST", "/api/gmail/poll")).json(); toast({ title: `확인했습니다 — 새로 가져온 메일 ${r.delivered}통` }); })}>
              {busy === "poll" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}지금 확인
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} data-testid="button-gmail-backfill"
              onClick={() => act("preview", async () => setBf(await (await apiRequest("POST", "/api/gmail/backfill", { since, apply: false })).json()))}>
              {busy === "preview" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}놓친 메일 찾기…
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { if (window.confirm("Gmail 연결을 끊을까요? 메일을 더 가져오지 않습니다.")) act("disc", () => apiRequest("POST", "/api/gmail/disconnect")); }}>연결 끊기</Button>
            {st.lastError && <Button size="sm" disabled={!!busy} onClick={() => act("connect", async () => { const r = await (await apiRequest("POST", "/api/gmail/connect")).json(); window.location.href = r.url; })}>다시 연결</Button>}
          </>}
        </div>
      </div>

      <AlertDialog open={bf !== null} onOpenChange={o => { if (!o && !busy) setBf(null); }}>
        <AlertDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{bf?.apply ? "가져왔습니다" : "놓친 메일"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>크기 때문에 Cloudmailin이 거절해서 앱에 안 들어온 메일 중, 등록된 공급처가 보낸 것입니다.
                  <span className="whitespace-nowrap"> 기간: <input type="date" className="border rounded px-1 text-xs" value={since} onChange={e => setSince(e.target.value)} disabled={!!busy || bf?.apply} /> 부터</span></p>
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(bf?.summary ?? {}).map(([sup, acts]) => (
                      <tr key={sup} className="border-t"><td className="py-1 pr-2 font-medium">{sup}</td>
                        <td className="py-1">{Object.entries(acts).map(([a, n]) => `${GMAIL_ACTION_KO[a] ?? a} ${n}`).join(" · ")}</td></tr>
                    ))}
                  </tbody>
                </table>
                {bf && Object.keys(bf.summary).length === 0 && <p>놓친 메일이 없습니다.</p>}
                {!bf?.apply && toDeliver > 0 && <p>"가져오기"를 누르면 이 {toDeliver}통을 지금 들어온 메일처럼 처리합니다 (인보이스는 To Pay에, 명세서는 명세서함에). 이미 장부에 있는 번호는 건너뜁니다.</p>}
                {bf?.rows.filter(r => r.action === "failed").map((r, i) => <p key={i} className="text-destructive">{r.subject}: {r.error}</p>)}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>{bf?.apply ? "닫기" : "취소"}</AlertDialogCancel>
            {!bf?.apply && (
              <Button variant="outline" disabled={!!busy} onClick={() => act("preview", async () => setBf(await (await apiRequest("POST", "/api/gmail/backfill", { since, apply: false })).json()))}>다시 찾기</Button>
            )}
            {!bf?.apply && toDeliver > 0 && (
              <Button disabled={!!busy} data-testid="button-gmail-backfill-apply"
                onClick={() => act("apply", async () => { const r = await (await apiRequest("POST", "/api/gmail/backfill", { since, apply: true })).json(); setBf(r); queryClient.invalidateQueries(); })}>
                {busy === "apply" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}가져오기 ({toDeliver})
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
