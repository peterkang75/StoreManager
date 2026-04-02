import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AddInvoiceModal from "@/components/AddInvoiceModal";
import { useToast } from "@/hooks/use-toast";
import type { SupplierInvoice, Supplier, Store, EmailRoutingRule } from "@shared/schema";

type EnrichedInvoice = SupplierInvoice & { supplier: Supplier | null };

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
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
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
      const action = mode === "link" ? "linked to existing supplier" : "created";
      if (result?.allDuplicates) {
        toast({
          title: `Supplier ${action}`,
          description: "All invoices from this statement already exist in the system. This review entry has been archived.",
        });
      } else {
        toast({ title: `Supplier ${action} — ${count} invoice${count !== 1 ? "s" : ""} moved to Pending` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-routing-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve supplier", description: err?.message, variant: "destructive" });
    },
  });

  function onSubmit(data: SupplierFormValues) {
    if (mode === "link" && !linkedSupplierId) {
      toast({ title: "Select a supplier to link to", variant: "destructive" });
      return;
    }
    approveMutation.mutate(data);
  }

  return (
    <Dialog open={invoices.length > 0} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-approve-supplier">
        <DialogHeader>
          <DialogTitle>Approve Invoices</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoices.length > 1 && (
              <span>All {invoices.length} invoices from this sender will move to Pending.</span>
            )}
          </p>
        </DialogHeader>

        {/* Statement-of-account warning */}
        {(raw as any)?._isStatement && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Statement of Account detected.</strong> This document may contain a grand total instead of individual invoice rows.
              Please verify the amount before approving — only approve if you are sure this is a valid invoice, not a statement summary.
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
            Create New Supplier
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
            Link to Existing
          </button>
        </div>

        {/* Supplier search — shown only in link mode */}
        {mode === "link" && (
          <div className="space-y-1.5">
            <Label>Select Existing Supplier</Label>
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
                  {linkedSupplier ? linkedSupplier.name : "Search suppliers…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput placeholder="Type to search…" data-testid="input-supplier-search" />
                  <CommandList>
                    <CommandEmpty>No supplier found.</CommandEmpty>
                    <CommandGroup>
                      {allSuppliers
                        .filter(s => s.active !== false)
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
                              <span className="ml-auto text-xs text-amber-600 font-medium">No email</span>
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
                This supplier has no email on file — the incoming email will be saved automatically.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {mode === "create" && (
            <p className="text-xs text-muted-foreground">Review and confirm the AI-extracted supplier details before creating.</p>
          )}
          {mode === "link" && linkedSupplier && (
            <p className="text-xs text-muted-foreground">Fields below show the existing supplier's data. Fill in any blanks to update missing info.</p>
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
              <p className="text-xs text-muted-foreground">Comma-separated. These will be whitelisted for future auto-import.</p>
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
                <Label htmlFor="approve-autopay" className="cursor-pointer font-medium">Auto-Pay (Direct Debit)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">This supplier auto-debits — invoices will be recorded as PAID immediately.</p>
              </div>
            </div>
            <Switch
              id="approve-autopay"
              checked={isAutoPay}
              onCheckedChange={setIsAutoPay}
              data-testid="switch-approve-autopay"
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={approveMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={approveMutation.isPending || (mode === "link" && !linkedSupplierId)}
              data-testid="button-confirm-approve-supplier"
            >
              {approveMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{mode === "link" ? "Linking…" : "Creating…"}</>
              ) : mode === "link" ? (
                <><Link2 className="h-3.5 w-3.5 mr-1.5" />Link Supplier & Approve</>
              ) : (
                <><UserPlus className="h-3.5 w-3.5 mr-1.5" />Create Supplier & Approve</>
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
        title: `Invoice reassigned to ${selectedSupplier?.name ?? "supplier"}`,
      });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "Failed to reassign invoice", description: err?.message, variant: "destructive" });
    },
  });

  if (!invoice) return null;

  const currentSupplierName = invoice.supplier?.name ?? "Unknown Supplier";
  const invNum = invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : "invoice";

  return (
    <Dialog open={!!invoice} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-reassign-supplier">
        <DialogHeader>
          <DialogTitle>Change Supplier</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Reassign {invNum} from <strong>{currentSupplierName}</strong> to the correct supplier.
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Select correct supplier</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="button-reassign-supplier-picker"
                >
                  {selectedSupplier ? selectedSupplier.name : "Search suppliers…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput placeholder="Type to search…" data-testid="input-reassign-supplier-search" />
                  <CommandList>
                    <CommandEmpty>No supplier found.</CommandEmpty>
                    <CommandGroup>
                      {allSuppliers
                        .filter(s => s.active !== false && s.id !== invoice.supplierId)
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
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedSupplierId || reassignMutation.isPending}
            onClick={() => reassignMutation.mutate()}
            data-testid="button-confirm-reassign"
          >
            {reassignMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Reassigning…</>
              : <><Link2 className="h-3.5 w-3.5 mr-1.5" />Reassign</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type TabKey = "topay" | "review" | "history" | "emailrules" | "trash";

export function AdminAccountsPayable() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("topay");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const defaultFilterSet = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedPayDates, setExpandedPayDates] = useState<Set<string>>(new Set());
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [approveInvoiceGroup, setApproveInvoiceGroup] = useState<SupplierInvoice[]>([]);
  const [revertInvoice, setRevertInvoice] = useState<EnrichedInvoice | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
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

  const { data: reviewInvoices = [], isLoading: reviewLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/invoices/review"],
    staleTime: 30_000,
  });

  const { data: deletedInvoices = [], isLoading: trashLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/supplier-invoices/deleted"],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: emailRules = [], isLoading: rulesLoading } = useQuery<EmailRoutingRule[]>({
    queryKey: ["/api/email-routing-rules"],
    staleTime: 30_000,
  });

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  // ── Store filter ────────────────────────────────────────────────────────────
  const STORE_ORDER = ["sushi", "sandwich", "holding", "pyc"];
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
    // Only show invoices assigned to the selected store.
    // Unassigned (storeId=null) invoices are visible only in "All Stores" view.
    return allInvoices.filter(inv => inv.storeId === storeFilter);
  }, [allInvoices, storeFilter]);

  const toPayInvoices = useMemo(
    () => storeFiltered.filter(inv => inv.status === "PENDING" || inv.status === "OVERDUE"),
    [storeFiltered]
  );
  const historyInvoices = useMemo(
    () =>
      storeFiltered
        .filter(inv => inv.status === "PAID")
        .sort((a, b) => {
          const da = a.updatedAt?.toString() ?? a.invoiceDate ?? "";
          const db = b.updatedAt?.toString() ?? b.invoiceDate ?? "";
          return db.localeCompare(da);
        }),
    [storeFiltered]
  );

  // Group paid invoices by payment date (updatedAt date) for the collapsible history view
  const historyGrouped = useMemo(() => {
    const groups = new Map<string, typeof historyInvoices>();
    for (const inv of historyInvoices) {
      const raw = inv.updatedAt?.toString() ?? inv.invoiceDate ?? "";
      const payDate = raw.slice(0, 10); // YYYY-MM-DD
      if (!groups.has(payDate)) groups.set(payDate, []);
      groups.get(payDate)!.push(inv);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [historyInvoices]);

  const togglePayDate = (dateKey: string) => {
    setExpandedPayDates(prev => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
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

  // ── Mutations ───────────────────────────────────────────────────────────────
  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/invoices/${id}/status`, { status: "PAID" })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      const n = selected.size;
      setSelected(new Set());
      toast({ title: `${n} invoice${n !== 1 ? "s" : ""} marked as paid` });
    },
    onError: () => toast({ title: "Failed to update invoices", variant: "destructive" }),
  });

  const revertMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("POST", `/api/invoices/${invoiceId}/revert`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice reverted to To Pay" });
      setRevertInvoice(null);
    },
    onError: () => {
      toast({ title: "Failed to revert invoice", variant: "destructive" });
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
      toast({ title: "Supplier ignored", description: "All pending invoices from this supplier have been discarded." });
    },
    onError: () => toast({ title: "Failed to ignore supplier", variant: "destructive" }),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/supplier-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      toast({ title: "Invoice deleted", description: "The invoice has been removed." });
    },
    onError: () => toast({ title: "Failed to delete invoice", variant: "destructive" }),
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/supplier-invoices/${id}/soft-delete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: "Invoice moved to Trash", description: "You can restore it from the Trash tab." });
    },
    onError: () => toast({ title: "Failed to delete invoice", variant: "destructive" }),
  });

  const bulkSoftDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/supplier-invoices/${id}/soft-delete`)));
    },
    onSuccess: () => {
      const n = selected.size;
      setSelected(new Set());
      setBulkDeleteConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: `${n} invoice${n !== 1 ? "s" : ""} moved to Trash`, description: "Restore them from the Trash tab if needed." });
    },
    onError: () => {
      toast({ title: "Failed to delete invoices", variant: "destructive" });
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
      toast({ title: "Invoice restored", description: "The invoice has been moved back." });
    },
    onError: () => toast({ title: "Failed to restore invoice", variant: "destructive" }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/supplier-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/deleted"] });
      toast({ title: "Permanently deleted", description: "The invoice has been permanently removed." });
    },
    onError: () => toast({ title: "Failed to permanently delete", variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (email: string) => {
      await apiRequest("DELETE", `/api/email-routing-rules/${encodeURIComponent(email)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-routing-rules"] });
      toast({ title: "Routing rule deleted", description: "Future emails from this address will be processed as unknown." });
    },
    onError: () => toast({ title: "Failed to delete rule", variant: "destructive" }),
  });

  const reparsePdfMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      return apiRequest("POST", `/api/supplier-invoices/${invoiceId}/reparse-pdf`);
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/review"] });
      toast({
        title: "PDF re-parsed",
        description: `${result?.invoiceCount ?? 0} invoice rows extracted. Approve again to apply.`,
      });
    },
    onError: () => toast({ title: "Re-parse failed", description: "Could not re-extract from the stored PDF.", variant: "destructive" }),
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

  useEffect(() => {
    if (supplierGroups.length > 0) {
      setOpenAccordions(prev =>
        prev.length === 0 ? supplierGroups.map(g => g.supplierId) : prev
      );
    }
  }, [supplierGroups]);

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
  const reviewGroups = useMemo<ReviewGroup[]>(() => {
    const map = new Map<string, ReviewGroup>();
    for (const inv of reviewInvoices) {
      const r = inv.rawExtractedData as ReviewRawData | null;
      // Smart hint: trusted AI name > subject cleanup > domain (external only) > "Unknown Supplier"
      const hint = extractSupplierHint(r, inv.notes ?? null);
      const name = hint.name || "Unknown Supplier";
      const abn = hint.abn;
      const senderEmail = hint.email;
      const rawSenderEmail = hint.rawSenderEmail;

      // Grouping key: prefer ABN (globally unique) over name to avoid false merges
      // from similar-but-different supplier names. Fall back to name if no ABN.
      // For truly unknown invoices with no name and no ABN, use invoice ID so they
      // appear as individual entries rather than merging into one "Unknown Supplier" blob.
      const groupKey = abn ? `abn:${abn}` : (name !== "Unknown Supplier" ? `name:${name}` : `id:${inv.id}`);

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
      key: "emailrules",
      label: "Email Rules",
      badge: emailRules.length > 0 ? emailRules.length : undefined,
      badgeColor: "bg-muted text-muted-foreground",
    },
    {
      key: "trash",
      label: "Trash",
      badge: deletedInvoices.length > 0 ? deletedInvoices.length : undefined,
      badgeColor: "bg-muted text-muted-foreground",
    },
  ];

  const showStoreFilter = activeTab === "topay" || activeTab === "history";
  const showSummaryCards = activeTab === "topay";

  return (
    <AdminLayout title="Accounts Payable">
      <div className="flex flex-col gap-5">

        {/* ── Page header actions ────────────────────────────────────────── */}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => setAddInvoiceOpen(true)}
            data-testid="button-add-invoice"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Invoice
          </Button>
        </div>

        {/* ── Summary Cards (To Pay only) ────────────────────────────────── */}
        {showSummaryCards && (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Payable</p>
                    <p className="text-2xl font-bold tracking-tight tabular-nums" data-testid="text-total-payable">
                      {fmtAUD(totalPayable)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{toPayInvoices.length} pending invoices</p>
                  </div>
                  <DollarSign className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                {totalOverdue > 0 && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Overdue: {fmtAUD(totalOverdue)}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className={selected.size > 0 ? "border-primary/40" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Selected Total</p>
                    <p className={`text-2xl font-bold tracking-tight tabular-nums transition-colors ${selected.size > 0 ? "text-primary" : "text-muted-foreground/50"}`} data-testid="text-selected-total-card">
                      {fmtAUD(selectedTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selected.size > 0 ? `${selected.size} invoice${selected.size !== 1 ? "s" : ""} selected` : "None selected"}
                    </p>
                  </div>
                  <CheckCircle className={`h-4 w-4 shrink-0 mt-0.5 transition-colors ${selected.size > 0 ? "text-primary" : "text-muted-foreground"}`} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Tab bar + Pay action ───────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg shrink-0 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); clearSelection(); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${tab.key}`}
              >
                {tab.label}
                {tab.badge !== undefined && (
                  <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                    activeTab === tab.key ? tab.badgeColor : "bg-muted text-muted-foreground"
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {activeTab === "topay" && selected.size > 0 && (
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-foreground whitespace-nowrap" data-testid="text-selected-total">
                {fmtAUD(selectedTotal)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={clearSelection}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteConfirmOpen(true)}
                disabled={bulkSoftDeleteMutation.isPending}
                data-testid="button-bulk-delete"
                className="gap-1.5 whitespace-nowrap text-destructive border-destructive/40 hover:bg-destructive/5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete ({selected.size})
              </Button>
              <Button
                size="sm"
                onClick={() => bulkMarkPaidMutation.mutate(Array.from(selected))}
                disabled={bulkMarkPaidMutation.isPending}
                data-testid="button-bulk-mark-paid"
                className="gap-1.5 whitespace-nowrap"
              >
                {bulkMarkPaidMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Paying…</>
                ) : (
                  <><CheckCircle className="h-3.5 w-3.5" />Pay Selected ({selected.size})</>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* ── Store Filter (To Pay + History only) ──────────────────────── */}
        {showStoreFilter && (
          <div className="flex items-center gap-1 flex-wrap">
            {[...filteredStores.map(s => ({ id: s.id, label: s.name })), { id: "ALL", label: "All Stores" }].map(opt => {
              const isActive = storeFilter === opt.id;
              const brandColor =
                opt.label.toLowerCase().includes("sushi") ? "#EE864A" :
                opt.label.toLowerCase().includes("sandwich") ? "#D13535" : null;
              return (
                <button
                  key={opt.id}
                  onClick={() => { setStoreFilter(opt.id); clearSelection(); }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    isActive
                      ? "text-white border-transparent"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  }`}
                  style={isActive ? { backgroundColor: brandColor ?? "#1a1a1a", borderColor: brandColor ?? "#1a1a1a" } : {}}
                  data-testid={`button-store-filter-${opt.id}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Content Area ───────────────────────────────────────────────── */}

        {/* ── TO PAY ── */}
        {activeTab === "topay" && (
          isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading invoices…</span>
            </div>
          ) : toPayInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <CheckCircle className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">All invoices are paid</p>
              <p className="text-xs">Nothing outstanding for this store filter.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {unassignedToPayCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    {unassignedToPayCount} unassigned invoice{unassignedToPayCount !== 1 ? "s" : ""} not shown here.
                  </span>
                  <button
                    className="ml-auto underline underline-offset-2 font-medium hover:opacity-80 whitespace-nowrap"
                    onClick={() => setStoreFilter("ALL")}
                  >
                    View in All Stores
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
                      {/* Header — bottom border appears only when expanded */}
                      <AccordionPrimitive.Header className="flex items-center w-full px-4 py-3 hover:bg-muted/20 transition-colors group-data-[state=open]:border-b group-data-[state=open]:border-border/20">
                        {/* Checkbox: hidden for Auto-Pay suppliers, replaced with spacer */}
                        {group.isAutoPay ? (
                          <div className="w-4 h-4 mr-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <Checkbox
                            checked={allGroupSelected}
                            data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                            onCheckedChange={() => toggleSupplier(group)}
                            aria-label={`Select all invoices for ${group.supplierName}`}
                            data-testid={`checkbox-supplier-${group.supplierId}`}
                            className="mr-3 shrink-0"
                          />
                        )}

                        <AccordionPrimitive.Trigger className="flex flex-1 items-center gap-3 min-w-0 text-left">
                          {/* LEFT — supplier name + badge + count */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <p className="font-semibold text-sm truncate">{group.supplierName}</p>
                            {group.isAutoPay && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 whitespace-nowrap shrink-0" data-testid={`badge-autopay-${group.supplierId}`}>
                                <Zap className="h-2.5 w-2.5" />
                                Direct Debit
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground shrink-0">
                              {group.invoices.length} invoice{group.invoices.length !== 1 ? "s" : ""}
                            </span>
                          </div>

                          {/* CENTRE — total + selected */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {fmtAUD(group.totalAmount)}
                            </span>
                            {groupSelectedCount > 0 && (
                              <span className="text-sm font-bold tabular-nums text-primary flex items-center gap-1">
                                <CheckCircle className="h-3.5 w-3.5" />
                                {fmtAUD(groupSelectedTotal)}
                                <span className="text-xs font-medium opacity-75">({groupSelectedCount})</span>
                              </span>
                            )}
                          </div>

                          {/* FAR RIGHT — overdue + chevron */}
                          <div className="flex items-center gap-2 shrink-0">
                            {group.overdueAmount > 0 && (
                              <span className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Overdue: {fmtAUD(group.overdueAmount)}
                              </span>
                            )}
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          </div>
                        </AccordionPrimitive.Trigger>
                      </AccordionPrimitive.Header>

                      <AccordionContent className="pb-0">
                        <div className="bg-muted/20 dark:bg-muted/10">
                          <table className="w-full text-sm" data-testid={`invoice-table-${group.supplierId}`}>
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
                              {group.invoices
                                .slice()
                                .sort((a, b) => {
                                  const oa = isOverdue(a.dueDate, a.status) ? 0 : 1;
                                  const ob = isOverdue(b.dueDate, b.status) ? 0 : 1;
                                  if (oa !== ob) return oa - ob;
                                  return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
                                })
                                .map(inv => {
                                  const overdue = isOverdue(inv.dueDate, inv.status);
                                  const dueSoon = isDueSoon(inv.dueDate, inv.status);
                                  const isChecked = selected.has(inv.id);
                                  const store = stores.find(s => s.id === inv.storeId);
                                  const isAutoDebitRow = inv.supplier?.isAutoPay === true;

                                  return (
                                    <tr
                                      key={inv.id}
                                      className={`border-b border-border/10 last:border-0 transition-colors ${
                                        isAutoDebitRow
                                          ? "opacity-60"
                                          : isChecked
                                            ? "bg-primary/5"
                                            : overdue
                                              ? "bg-red-50/40 dark:bg-red-950/10"
                                              : "hover:bg-muted/20"
                                      }`}
                                      data-testid={`row-invoice-${inv.id}`}
                                    >
                                      <td className="pl-4 py-2.5 w-10">
                                        {isAutoDebitRow ? (
                                          /* No checkbox for auto-pay invoices — selection is disabled */
                                          <div className="w-4 h-4" aria-hidden="true" data-testid={`no-checkbox-autopay-${inv.id}`} />
                                        ) : (
                                          <Checkbox
                                            checked={isChecked}
                                            onCheckedChange={() => toggleOne(inv.id)}
                                            aria-label={`Select invoice ${inv.invoiceNumber}`}
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
                                        {displayInvNumber(inv.invoiceNumber)}
                                      </td>
                                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                                        {store?.name ?? "—"}
                                      </td>
                                      <td className="py-2.5 pr-4 w-20">
                                        <div className="flex items-center gap-0.5 justify-end">
                                          {((inv.rawExtractedData as any)?.pdfBase64 || inv.notes) && (
                                            <button
                                              type="button"
                                              title={(inv.rawExtractedData as any)?.pdfBase64 ? "View PDF Invoice" : inv.notes}
                                              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${(inv.rawExtractedData as any)?.pdfBase64 ? "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                                              data-testid={`button-notes-${inv.id}`}
                                              onClick={(inv.rawExtractedData as any)?.pdfBase64 ? (e) => {
                                                e.stopPropagation();
                                                window.open(`/api/supplier-invoices/${inv.id}/pdf`, "_blank");
                                              } : undefined}
                                            >
                                              <FileText className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            title="Change Supplier"
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
                                            title="Move to Trash"
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
              <span className="text-sm">Loading review inbox…</span>
            </div>
          ) : reviewGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Inbox className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Review inbox is empty</p>
              <p className="text-xs">New invoices from unknown senders will appear here for review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviewGroups.map(group => {
                const raw = group.rawFirst;
                const isPending = ignoreSenderMutation.isPending;
                // Use ABN (if known) or first invoice ID as the stable groupKey for React keys and test IDs
                const groupKey = group.abn || group.invoices[0]?.id || group.supplierName;

                return (
                  <Card key={groupKey} className="overflow-hidden" data-testid={`review-card-${groupKey}`}>
                    <CardContent className="p-0">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/30 bg-muted/20">
                        <div className="flex items-start gap-3 min-w-0">
                          <Mail className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate" data-testid={`text-review-supplier-${groupKey}`}>
                              {group.supplierName}
                            </p>
                            {group.abn && (
                              <p className="text-xs text-muted-foreground" data-testid={`text-review-abn-${groupKey}`}>
                                ABN {group.abn}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground" data-testid={`text-review-count-${groupKey}`}>
                              {group.invoices.length === 1
                                ? "1 pending invoice"
                                : `${group.invoices.length} pending invoices`}
                            </p>
                            {group.senderEmail && (
                              <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                                via {group.senderEmail}
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
                          <p className="text-xs text-muted-foreground">total</p>
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
                            <span className="text-muted-foreground shrink-0 w-20">Account</span>
                            <span className="font-medium font-mono">{raw.supplier.accountNumber}</span>
                          </div>
                        )}
                        {(raw?.supplier?.supplierAddress ?? raw?.supplier?.address) && (
                          <div className="flex gap-2 col-span-2">
                            <span className="text-muted-foreground shrink-0 w-20">Address</span>
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
                                        {displayInvNumber(ir?.invoiceNumber) !== "—" ? `#${ir?.invoiceNumber}` : "No invoice #"}
                                      </span>
                                      {ir?.issueDate && <span className="text-muted-foreground text-xs">{fmt(ir.issueDate)}</span>}
                                      {ir?.totalAmount !== undefined && ir.totalAmount > 0 && (
                                        <span className="font-medium tabular-nums text-xs">{fmtAUD(ir.totalAmount)}</span>
                                      )}
                                      {(ir as any)?._isStatement && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-700 border-amber-400 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30 shrink-0">
                                          Statement
                                        </Badge>
                                      )}
                                      {inv.createdAt && (
                                        <span className="text-muted-foreground/60 text-xs ml-auto">
                                          Received {fmtReceived(inv.createdAt)}
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
                                        From: {emailInfo.from}
                                      </p>
                                    )}
                                    {/* Notes fallback when no structured data at all */}
                                    {!hasUsefulInvoiceData && !emailInfo.subject && !emailInfo.from && inv.notes && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                        {inv.notes.slice(0, 160)}
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
                                      title="View full email"
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
                                      title="Delete invoice"
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
                          Ignore Supplier
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
                            Re-parse PDF
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => setApproveInvoiceGroup(group.invoices)}
                          data-testid={`button-approve-${groupKey}`}
                          className="gap-1.5"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Approve & Add Supplier
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
        {activeTab === "history" && (
          isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading history…</span>
            </div>
          ) : historyInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Receipt className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">No paid invoices</p>
              <p className="text-xs">Paid invoices will appear here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {historyGrouped.map(([dateKey, invoices]) => {
                const isExpanded = expandedPayDates.has(dateKey);
                const groupTotal = invoices.reduce((s, inv) => s + (inv.amount ?? 0), 0);
                const displayDate = dateKey
                  ? new Date(dateKey + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
                  : "Unknown Date";
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
                        {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
                      </span>
                      <span className="font-semibold tabular-nums text-sm">{fmtAUD(groupTotal)}</span>
                    </button>

                    {/* ── Expanded rows ── */}
                    {isExpanded && (
                      <CardContent className="p-0 border-t border-border/40">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/30">
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Supplier</th>
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Store</th>
                              <th className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Payment</th>
                              <th className="py-2 px-4 w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map(inv => {
                              const store = stores.find(s => s.id === inv.storeId);
                              const isAutoDebit = inv.supplier?.isAutoPay === true;
                              return (
                                <tr
                                  key={inv.id}
                                  className="border-t border-border/10 hover:bg-muted/20 transition-colors"
                                  data-testid={`row-invoice-${inv.id}`}
                                >
                                  <td className="py-2.5 px-4 font-medium">
                                    {inv.supplier?.name ?? <span className="text-muted-foreground italic">Unknown</span>}
                                  </td>
                                  <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">{fmt(inv.invoiceDate)}</td>
                                  <td className="py-2.5 px-4 font-semibold tabular-nums text-right whitespace-nowrap">{fmtAUD(inv.amount ?? 0)}</td>
                                  <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{displayInvNumber(inv.invoiceNumber)}</td>
                                  <td className="py-2.5 px-4 text-xs text-muted-foreground">{store?.name ?? "—"}</td>
                                  <td className="py-2.5 px-4">
                                    {isAutoDebit ? (
                                      <span
                                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                        data-testid={`badge-autopaid-${inv.id}`}
                                      >
                                        <Zap className="h-2.5 w-2.5" />
                                        Auto-Paid
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">Manual</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pr-3 w-16">
                                    <div className="flex items-center gap-1 justify-end">
                                      {((inv.rawExtractedData as any)?.pdfBase64 || inv.notes) && (
                                        <button
                                          type="button"
                                          title={(inv.rawExtractedData as any)?.pdfBase64 ? "View PDF Invoice" : inv.notes}
                                          className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${(inv.rawExtractedData as any)?.pdfBase64 ? "text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                                          data-testid={`button-notes-${inv.id}`}
                                          onClick={(inv.rawExtractedData as any)?.pdfBase64 ? () => window.open(`/api/supplier-invoices/${inv.id}/pdf`, "_blank") : undefined}
                                        >
                                          <FileText className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        title="Revert to Pending (e.g. bounced direct debit)"
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
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )
        )}

        {/* ── EMAIL RULES ── */}
        {activeTab === "emailrules" && (
          rulesLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading email rules…</span>
            </div>
          ) : emailRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Mail className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">No email routing rules</p>
              <p className="text-xs">Rules are created when you approve or ignore senders from the Review Inbox.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm" data-testid="table-email-rules">
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
                            {rule.action === "ROUTE_TO_AP" ? "Payables"
                              : rule.action === "ROUTE_TO_TODO" ? "To-Do"
                              : rule.action === "FYI_ARCHIVE" ? "FYI"
                              : rule.action === "SPAM_DROP" ? "Spam"
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
                            title="Delete rule"
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

        {/* ── TRASH ── */}
        {activeTab === "trash" && (
          trashLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading trash…</span>
            </div>
          ) : deletedInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Trash2 className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Trash is empty</p>
              <p className="text-xs">Deleted invoices will appear here and can be restored.</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
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
                                Restore
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
                                Delete Forever
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
            <AlertDialogTitle>Revert Invoice to Pending?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move{" "}
              <strong>{revertInvoice?.supplier?.name ?? "this invoice"}</strong>{" "}
              {displayInvNumber(revertInvoice?.invoiceNumber) !== "—" ? `(#${revertInvoice?.invoiceNumber})` : ""} back to the{" "}
              <strong>To Pay</strong> list and permanently remove its payment record.
              {revertInvoice?.supplier?.isAutoPay && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  This supplier uses Auto-Pay (Direct Debit). Only revert if the debit has bounced or failed.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-revert-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revertInvoice && revertMutation.mutate(revertInvoice.id)}
              disabled={revertMutation.isPending}
              className="bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600"
              data-testid="button-revert-confirm"
            >
              {revertMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Reverting…</>
              ) : (
                <><Undo2 className="h-3.5 w-3.5 mr-1.5" />Revert to Pending</>
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
                      <span><span className="text-foreground/50 w-14 inline-block">From:</span> {from}</span>
                      {displayInvNumber(viewEmailInvoice.invoiceNumber) !== "—" && (
                        <span><span className="text-foreground/50 w-14 inline-block">Invoice:</span> {viewEmailInvoice.invoiceNumber}</span>
                      )}
                      {viewEmailInvoice.createdAt && (
                        <span><span className="text-foreground/50 w-14 inline-block">Received:</span> {new Date(viewEmailInvoice.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span>
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
                        title="Email content"
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
                    <p className="text-sm text-muted-foreground italic">No email body stored for this invoice.</p>
                  </div>
                )}

                {/* System notes — always shown separately */}
                {systemNotes && (
                  <div className={`px-5 py-3 bg-muted/20 ${emailBody ? "border-t border-border/30" : ""}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">System Notes</p>
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
                      onClick={() => window.open(`/api/supplier-invoices/${viewEmailInvoice.id}/pdf`, "_blank")}
                      data-testid="button-view-email-pdf"
                      className="gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View PDF
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
                    Close
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
                    Approve & Add Supplier
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Bulk Delete Confirmation Dialog ───────────────────────────────────── */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={open => !open && setBulkDeleteConfirmOpen(false)}>
        <AlertDialogContent data-testid="dialog-bulk-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.size} invoice{selected.size !== 1 ? "s" : ""} will be moved to the Trash.
              You can restore them from the <strong>Trash</strong> tab if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={bulkSoftDeleteMutation.isPending}
              data-testid="button-bulk-delete-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkSoftDeleteMutation.mutate(Array.from(selected))}
              disabled={bulkSoftDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-bulk-delete-confirm"
            >
              {bulkSoftDeleteMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Deleting…</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5 mr-1.5" />Move to Trash</>
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
