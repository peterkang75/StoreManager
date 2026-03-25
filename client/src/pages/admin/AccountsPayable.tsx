import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  DollarSign,
  Receipt,
  Loader2,
} from "lucide-react";
import type { SupplierInvoice, Supplier, Store } from "@shared/schema";

type EnrichedInvoice = SupplierInvoice & { supplier: Supplier | null };

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Supplier group structure ────────────────────────────────────────────────────

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

// ── Main Component ─────────────────────────────────────────────────────────────

export function AdminAccountsPayable() {
  const { toast } = useToast();

  // View tab: "topay" | "history"
  const [activeTab, setActiveTab] = useState<"topay" | "history">("topay");
  // Store filter: "ALL" | store id (only Sushi/Sandwich)
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  // Selected invoice IDs
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Open accordion items
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);

  // Fetch all invoices (we split client-side for the two tabs)
  const { data: allInvoices = [], isLoading } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", "ALL"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  // Store filter order: Sushi → Sandwich → Holdings → PYC
  const STORE_ORDER = ["sushi", "sandwich", "holding", "pyc"];
  const filteredStores = useMemo(() => {
    const matched = STORE_ORDER.flatMap(keyword =>
      stores.filter(s => s.active && s.name.toLowerCase().includes(keyword))
    );
    // deduplicate preserving order
    const seen = new Set<string>();
    return matched.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  }, [stores]);

  // Apply store filter
  const storeFiltered = useMemo(() => {
    if (storeFilter === "ALL") return allInvoices;
    return allInvoices.filter(inv => inv.storeId === storeFilter);
  }, [allInvoices, storeFilter]);

  // Split into tabs
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

  // Summary stats
  const totalPayable = useMemo(() => toPayInvoices.reduce((s, inv) => s + (inv.amount ?? 0), 0), [toPayInvoices]);
  const totalOverdue = useMemo(
    () => toPayInvoices.filter(inv => isOverdue(inv.dueDate, inv.status)).reduce((s, inv) => s + (inv.amount ?? 0), 0),
    [toPayInvoices]
  );

  // Supplier groups for To Pay view
  const supplierGroups = useMemo(() => groupBySupplier(toPayInvoices), [toPayInvoices]);

  // Selected total
  const selectedTotal = useMemo(() => {
    return toPayInvoices
      .filter(inv => selected.has(inv.id))
      .reduce((s, inv) => s + (inv.amount ?? 0), 0);
  }, [toPayInvoices, selected]);

  // Bulk mark paid mutation
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

  // Selection helpers
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
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Open all accordions by default when data first loads
  useEffect(() => {
    if (supplierGroups.length > 0) {
      setOpenAccordions(prev =>
        prev.length === 0 ? supplierGroups.map(g => g.supplierId) : prev
      );
    }
  }, [supplierGroups]);

  return (
    <AdminLayout title="Accounts Payable">
      <div className="flex flex-col gap-5 pb-24">

        {/* ── Summary Cards ─────────────────────────────────────────────── */}
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

        {/* ── Tab + Store Filter bar ─────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Left: View Tabs */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg shrink-0">
            <button
              onClick={() => { setActiveTab("topay"); clearSelection(); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "topay"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-topay"
            >
              To Pay
              {toPayInvoices.length > 0 && (
                <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === "topay"
                    ? totalOverdue > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {toPayInvoices.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab("history"); clearSelection(); }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-history"
            >
              Paid History
              {historyInvoices.length > 0 && (
                <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === "history" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-muted text-muted-foreground"
                }`}>
                  {historyInvoices.length}
                </span>
              )}
            </button>
          </div>

          {/* Center: Store Toggle Buttons */}
          <div className="flex-1 flex items-center justify-center gap-1 flex-wrap">
            {[{ id: "ALL", label: "All Stores" }, ...filteredStores.map(s => ({ id: s.id, label: s.name }))].map(opt => (
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

          {/* Right: spacer to balance layout */}
          <div className="shrink-0 w-[160px]" />
        </div>

        {/* ── Content Area ──────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading invoices…</span>
          </div>
        ) : activeTab === "topay" ? (
          /* ── To Pay: Supplier Accordion Groups ── */
          toPayInvoices.length === 0 ? (
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
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Supplier select-all checkbox */}
                          <div onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={allGroupSelected}
                              data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                              onCheckedChange={() => toggleSupplier(group)}
                              aria-label={`Select all invoices for ${group.supplierName}`}
                              data-testid={`checkbox-supplier-${group.supplierId}`}
                            />
                          </div>

                          {/* Supplier name + amounts */}
                          <div className="flex-1 min-w-0 text-left">
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
                        </div>
                      </AccordionTrigger>

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
        ) : (
          /* ── Paid History: flat sorted list ── */
          historyInvoices.length === 0 ? (
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
                      <th className="py-2.5 px-4 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {historyInvoices.map(inv => {
                      const store = stores.find(s => s.id === inv.storeId);
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
                          <td className="py-2.5 pr-4 w-8">
                            {inv.notes && (
                              <button type="button" title={inv.notes} className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors" data-testid={`button-notes-${inv.id}`}>
                                <FileText className="h-3.5 w-3.5" />
                              </button>
                            )}
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

      {/* ── Sticky Bottom Summary Bar ─────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border/40 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" data-testid="text-selected-total">
                {fmtAUD(selectedTotal)}
              </p>
              <p className="text-xs text-muted-foreground">
                {selected.size} invoice{selected.size !== 1 ? "s" : ""} selected
              </p>
            </div>
            <div className="flex items-center gap-2">
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
                className="gap-2"
              >
                {bulkMarkPaidMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Paying…</>
                ) : (
                  <><CheckCircle className="h-3.5 w-3.5" />Pay Selected ({selected.size})</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
