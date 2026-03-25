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
  ChevronDown,
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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AddInvoiceModal from "@/components/AddInvoiceModal";
import { useToast } from "@/hooks/use-toast";
import type { SupplierInvoice, Supplier, Store, EmailRoutingRule } from "@shared/schema";

type EnrichedInvoice = SupplierInvoice & { supplier: Supplier | null };

// ── rawExtractedData shape from webhook ──────────────────────────────────────
interface ExtractedSupplierInfo {
  supplierName: string;
  senderEmail?: string;
  abn?: string;
  address?: string;
  bsb?: string;
  accountNumber?: string;
  contactName?: string;
}
interface ReviewRawData {
  senderEmail: string;
  subject?: string;
  supplier: ExtractedSupplierInfo;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  storeCode?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function fmtAUD(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
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

function ApproveSupplierModal({ invoices, onClose, onSuccess }: ApproveSupplierModalProps) {
  const { toast } = useToast();
  // Use the first invoice's raw data for form pre-fill
  const firstInvoice = invoices[0] ?? null;
  const raw = firstInvoice?.rawExtractedData as ReviewRawData | null;
  const [isAutoPay, setIsAutoPay] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormValues>({
    defaultValues: {
      name: raw?.supplier?.supplierName ?? "",
      abn: raw?.supplier?.abn ?? "",
      contactName: raw?.supplier?.contactName ?? "",
      contactEmails: raw?.senderEmail ?? raw?.supplier?.senderEmail ?? "",
      bsb: raw?.supplier?.bsb ?? "",
      accountNumber: raw?.supplier?.accountNumber ?? "",
      address: raw?.supplier?.address ?? "",
      notes: "",
    },
  });

  useEffect(() => {
    if (firstInvoice) {
      const r = firstInvoice.rawExtractedData as ReviewRawData | null;
      reset({
        name: r?.supplier?.supplierName ?? "",
        abn: r?.supplier?.abn ?? "",
        contactName: r?.supplier?.contactName ?? "",
        contactEmails: r?.senderEmail ?? r?.supplier?.senderEmail ?? "",
        bsb: r?.supplier?.bsb ?? "",
        accountNumber: r?.supplier?.accountNumber ?? "",
        address: r?.supplier?.address ?? "",
        notes: "",
      });
      setIsAutoPay(false);
    }
  }, [firstInvoice?.id, reset]);

  const approveMutation = useMutation({
    mutationFn: async (data: SupplierFormValues) => {
      if (!firstInvoice) throw new Error("No invoices in group");
      const r = firstInvoice.rawExtractedData as ReviewRawData | null;
      const senderEmail = r?.senderEmail ?? "";
      const supplierName = r?.supplier?.supplierName ?? data.name;

      const emailsArray = data.contactEmails
        .split(",")
        .map(e => e.trim())
        .filter(Boolean);

      // Single API call: create supplier + sweep all matching REVIEW invoices
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
      });
    },
    onSuccess: (result: any) => {
      const count = result?.sweptCount ?? invoices.length;
      toast({ title: `Supplier created — ${count} invoice${count !== 1 ? "s" : ""} moved to Pending` });
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
    approveMutation.mutate(data);
  }

  return (
    <Dialog open={invoices.length > 0} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-approve-supplier">
        <DialogHeader>
          <DialogTitle>Approve & Add Supplier</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review and confirm the AI-extracted supplier details before creating.
            {invoices.length > 1 && (
              <span className="block mt-1 font-medium text-foreground">
                This will approve all {invoices.length} pending invoices from this supplier.
              </span>
            )}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sup-name">Supplier Name <span className="text-red-500">*</span></Label>
              <Input
                id="sup-name"
                {...register("name", { required: true })}
                placeholder="Supplier name"
                data-testid="input-supplier-name"
                className={errors.name ? "border-red-500" : ""}
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
            <Button type="submit" disabled={approveMutation.isPending} data-testid="button-confirm-approve-supplier">
              {approveMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Creating…</>
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

// ── Main Component ────────────────────────────────────────────────────────────

type TabKey = "topay" | "review" | "history" | "emailrules";

export function AdminAccountsPayable() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("topay");
  const [storeFilter, setStoreFilter] = useState<string>("");
  const defaultFilterSet = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [approveInvoiceGroup, setApproveInvoiceGroup] = useState<SupplierInvoice[]>([]);
  const [revertInvoice, setRevertInvoice] = useState<EnrichedInvoice | null>(null);

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

  const totalPayable = useMemo(() => toPayInvoices.reduce((s, inv) => s + (inv.amount ?? 0), 0), [toPayInvoices]);
  const totalOverdue = useMemo(
    () => toPayInvoices.filter(inv => isOverdue(inv.dueDate, inv.status)).reduce((s, inv) => s + (inv.amount ?? 0), 0),
    [toPayInvoices]
  );

  const supplierGroups = useMemo(() => groupBySupplier(toPayInvoices), [toPayInvoices]);

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
          action: "IGNORE",
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

  // ── Selection helpers ───────────────────────────────────────────────────────
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSupplier(group: SupplierGroup) {
    const ids = group.invoices.map(i => i.id);
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

  // ── Group review invoices by supplier name ───────────────────────────────────
  interface ReviewGroup {
    supplierName: string;
    invoices: SupplierInvoice[];
    totalAmount: number;
    senderEmail: string;
    rawFirst: ReviewRawData | null;
  }
  const reviewGroups = useMemo<ReviewGroup[]>(() => {
    const map = new Map<string, ReviewGroup>();
    for (const inv of reviewInvoices) {
      const r = inv.rawExtractedData as ReviewRawData | null;
      const name = r?.supplier?.supplierName ?? "Unknown Supplier";
      if (!map.has(name)) {
        map.set(name, {
          supplierName: name,
          invoices: [],
          totalAmount: 0,
          senderEmail: r?.senderEmail ?? "",
          rawFirst: r,
        });
      }
      const g = map.get(name)!;
      g.invoices.push(inv);
      g.totalAmount += r?.totalAmount ?? 0;
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
            {[...filteredStores.map(s => ({ id: s.id, label: s.name })), { id: "ALL", label: "All Stores" }].map(opt => (
              <button
                key={opt.id}
                onClick={() => { setStoreFilter(opt.id); clearSelection(); }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  storeFilter === opt.id
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
                data-testid={`button-store-filter-${opt.id}`}
              >
                {opt.label}
              </button>
            ))}
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
                      className="border border-border/40 rounded-lg bg-card overflow-hidden"
                      data-testid={`supplier-group-${group.supplierId}`}
                    >
                      <AccordionPrimitive.Header className="flex items-center px-4 py-3 hover:bg-muted/30 transition-colors">
                        <Checkbox
                          checked={allGroupSelected}
                          data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                          onCheckedChange={() => toggleSupplier(group)}
                          aria-label={`Select all invoices for ${group.supplierName}`}
                          data-testid={`checkbox-supplier-${group.supplierId}`}
                          className="mr-3 shrink-0"
                        />
                        <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between gap-2 min-w-0 text-left [&[data-state=open]>svg]:rotate-180">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">{group.supplierName}</p>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              <span className="text-xs text-muted-foreground">
                                {group.invoices.length} invoice{group.invoices.length !== 1 ? "s" : ""}
                              </span>
                              <span className="text-xs font-semibold text-foreground tabular-nums">
                                {fmtAUD(group.totalAmount)}
                              </span>
                              {groupSelectedCount > 0 && (
                                <span className="text-xs font-semibold text-primary tabular-nums flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                  {fmtAUD(groupSelectedTotal)} selected ({groupSelectedCount})
                                </span>
                              )}
                              {group.overdueAmount > 0 && (
                                <span className="text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-0.5">
                                  <AlertCircle className="h-3 w-3" />
                                  Overdue: {fmtAUD(group.overdueAmount)}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200" />
                        </AccordionPrimitive.Trigger>
                      </AccordionPrimitive.Header>

                      <AccordionContent className="pb-0">
                        <div className="border-t border-border/30">
                          <table className="w-full text-sm" data-testid={`invoice-table-${group.supplierId}`}>
                            <thead>
                              <tr className="bg-muted/30 border-b border-border/20">
                                <th className="w-10 py-2 pl-4" />
                                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Due Date</th>
                                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Store</th>
                                <th className="w-8 py-2 pr-4" />
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

                                  return (
                                    <tr
                                      key={inv.id}
                                      className={`border-b border-border/10 last:border-0 transition-colors ${
                                        isChecked ? "bg-primary/5" : overdue ? "bg-red-50/40 dark:bg-red-950/10" : "hover:bg-muted/20"
                                      }`}
                                      data-testid={`row-invoice-${inv.id}`}
                                    >
                                      <td className="pl-4 py-2.5 w-10">
                                        <Checkbox
                                          checked={isChecked}
                                          onCheckedChange={() => toggleOne(inv.id)}
                                          aria-label={`Select invoice ${inv.invoiceNumber}`}
                                          data-testid={`checkbox-invoice-${inv.id}`}
                                        />
                                      </td>
                                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                                        {fmt(inv.invoiceDate)}
                                      </td>
                                      <td className="py-2.5 px-3 font-semibold tabular-nums text-right whitespace-nowrap">
                                        {fmtAUD(inv.amount ?? 0)}
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
                                        {inv.invoiceNumber || "—"}
                                      </td>
                                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                                        {store?.name ?? "—"}
                                      </td>
                                      <td className="py-2.5 pr-4 w-8">
                                        {inv.notes && (
                                          <button
                                            type="button"
                                            title={inv.notes}
                                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                            data-testid={`button-notes-${inv.id}`}
                                          >
                                            <FileText className="h-3.5 w-3.5" />
                                          </button>
                                        )}
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
                const groupKey = group.supplierName;

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
                        {raw?.supplier?.address && (
                          <div className="flex gap-2 col-span-2">
                            <span className="text-muted-foreground shrink-0 w-20">Address</span>
                            <span className="font-medium">{raw.supplier.address}</span>
                          </div>
                        )}
                      </div>

                      {/* Individual invoice list */}
                      {group.invoices.length > 0 && (
                        <div className="px-4 pb-3 space-y-1">
                          {group.invoices.map(inv => {
                            const ir = inv.rawExtractedData as ReviewRawData | null;
                            return (
                              <div key={inv.id} className="flex items-center justify-between text-xs py-1 border-t border-border/20 first:border-t-0">
                                <span className="text-muted-foreground font-mono">
                                  {ir?.invoiceNumber ? `#${ir.invoiceNumber}` : "No invoice #"}
                                </span>
                                <div className="flex items-center gap-3">
                                  {ir?.issueDate && <span className="text-muted-foreground">{fmt(ir.issueDate)}</span>}
                                  {ir?.totalAmount !== undefined && ir.totalAmount > 0 && (
                                    <span className="font-medium tabular-nums">{fmtAUD(ir.totalAmount)}</span>
                                  )}
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
                              senderEmail: group.senderEmail,
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
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Supplier</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice Date</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right whitespace-nowrap">Amount</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Invoice #</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left">Store</th>
                      <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-left whitespace-nowrap">Payment</th>
                      <th className="py-2.5 px-4 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {historyInvoices.map(inv => {
                      const store = stores.find(s => s.id === inv.storeId);
                      const isAutoDebit = inv.supplier?.isAutoPay === true;
                      return (
                        <tr
                          key={inv.id}
                          className="border-b border-border/10 last:border-0 hover:bg-muted/20 transition-colors"
                          data-testid={`row-invoice-${inv.id}`}
                        >
                          <td className="py-2.5 px-4 font-medium">
                            {inv.supplier?.name ?? <span className="text-muted-foreground italic">Unknown</span>}
                          </td>
                          <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">{fmt(inv.invoiceDate)}</td>
                          <td className="py-2.5 px-4 font-semibold tabular-nums text-right whitespace-nowrap">{fmtAUD(inv.amount ?? 0)}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{inv.invoiceNumber || "—"}</td>
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
                              {inv.notes && (
                                <button type="button" title={inv.notes} className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors" data-testid={`button-notes-${inv.id}`}>
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
            </Card>
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
                              rule.action === "ALLOW"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                            }`}
                            data-testid={`text-rule-action-${rule.email}`}
                          >
                            {rule.action === "ALLOW" ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <Ban className="h-3 w-3" />
                            )}
                            {rule.action}
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
      </div>

      {/* ── Revert Confirmation Dialog ─────────────────────────────────────── */}
      <AlertDialog open={!!revertInvoice} onOpenChange={open => !open && setRevertInvoice(null)}>
        <AlertDialogContent data-testid="dialog-revert-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Invoice to Pending?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move{" "}
              <strong>{revertInvoice?.supplier?.name ?? "this invoice"}</strong>{" "}
              {revertInvoice?.invoiceNumber ? `(#${revertInvoice.invoiceNumber})` : ""} back to the{" "}
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

      <AddInvoiceModal
        open={addInvoiceOpen}
        onClose={() => setAddInvoiceOpen(false)}
      />

      <ApproveSupplierModal
        invoices={approveInvoiceGroup}
        onClose={() => setApproveInvoiceGroup([])}
        onSuccess={() => setApproveInvoiceGroup([])}
      />
    </AdminLayout>
  );
}
