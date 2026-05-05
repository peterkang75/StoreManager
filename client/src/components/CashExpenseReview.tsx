import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Check,
  AlertCircle,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import type { CashExpense, Supplier } from "@shared/schema";

const OTHER_UNKNOWN_NAME = "Other / Unknown";

type Granularity = "week" | "month" | "quarter";

const fmtAUD = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayInSydney(): Date {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  return new Date(ymd + "T00:00:00");
}

function getPeriodRange(g: Granularity, offset: number): { from: string; to: string; label: string } {
  const today = todayInSydney();
  if (g === "week") {
    const dayOfWeek = today.getDay() || 7; // Mon=1, Sun=7
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek - 1) + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    return {
      from: toYMD(monday),
      to: toYMD(sunday),
      label: `${fmt(monday)} – ${fmt(sunday)}`,
    };
  }
  if (g === "month") {
    const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    return {
      from: toYMD(start),
      to: toYMD(end),
      label: start.toLocaleDateString("en-AU", { month: "long", year: "numeric" }),
    };
  }
  // quarter
  const currentQ = Math.floor(today.getMonth() / 3);
  const totalQ = today.getFullYear() * 4 + currentQ + offset;
  const yr = Math.floor(totalQ / 4);
  const q = ((totalQ % 4) + 4) % 4;
  const start = new Date(yr, q * 3, 1);
  const end = new Date(yr, q * 3 + 3, 0);
  return { from: toYMD(start), to: toYMD(end), label: `Q${q + 1} ${yr}` };
}

type SummaryResponse = {
  total: number;
  gstTotal: number;
  pendingCount: number;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    total: number;
    gst: number;
    count: number;
  }>;
};

interface CashExpenseReviewProps {
  storeFilter: string; // real store id, "ALL", "UNASSIGNED" (treated as ALL), or ""
}

export function CashExpenseReview({ storeFilter }: CashExpenseReviewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [granularity, setGranularity] = useState<Granularity>("week");
  const [offset, setOffset] = useState(0);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [editingExpense, setEditingExpense] = useState<CashExpense | null>(null);
  const [pendingApprove, setPendingApprove] = useState<string | null>(null);

  const period = useMemo(() => getPeriodRange(granularity, offset), [granularity, offset]);

  // "ALL"/"UNASSIGNED" → no storeId filter (cash_expenses.store_id is NOT NULL,
  // so UNASSIGNED is impossible; treat as ALL).
  const storeIdParam =
    storeFilter && storeFilter !== "ALL" && storeFilter !== "UNASSIGNED" ? storeFilter : "";

  const queryParams = new URLSearchParams({ from: period.from, to: period.to });
  if (storeIdParam) queryParams.set("storeId", storeIdParam);

  const { data: rows = [], isLoading } = useQuery<CashExpense[]>({
    queryKey: ["/api/cash-expenses", period.from, period.to, storeIdParam],
    queryFn: async () => {
      const res = await fetch(`/api/cash-expenses?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to load cash expenses");
      return res.json();
    },
  });

  const { data: summary } = useQuery<SummaryResponse>({
    queryKey: ["/api/cash-expenses/summary", period.from, period.to, storeIdParam],
    queryFn: async () => {
      const res = await fetch(`/api/cash-expenses/summary?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
  });

  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });
  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSuppliers) m.set(s.id, s.name);
    return m;
  }, [allSuppliers]);

  const pendingRows = useMemo(() => rows.filter(r => r.reviewStatus === "PENDING"), [rows]);
  const rowsBySupplier = useMemo(() => {
    const m = new Map<string, CashExpense[]>();
    for (const r of rows) {
      const list = m.get(r.supplierId) ?? [];
      list.push(r);
      m.set(r.supplierId, list);
    }
    return m;
  }, [rows]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/cash-expenses"] });
    qc.invalidateQueries({ queryKey: ["/api/cash-expenses/summary"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      setPendingApprove(id);
      await apiRequest("PATCH", `/api/cash-expenses/${id}`, { reviewStatus: "APPROVED" });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
    onSettled: () => setPendingApprove(null),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/cash-expenses/${id}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const toggleSupplier = (id: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Period nav + granularity */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
          {(["week", "month", "quarter"] as Granularity[]).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => { setGranularity(g); setOffset(0); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                granularity === g ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-granularity-${g}`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setOffset(o => o - 1)}
            data-testid="button-period-prev"
            aria-label="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div
            className="px-3 py-1.5 min-w-[160px] text-center text-sm font-medium tabular-nums"
            data-testid="text-period-label"
          >
            {period.label}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setOffset(o => o + 1)}
            disabled={offset >= 0}
            data-testid="button-period-next"
            aria-label="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {offset !== 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setOffset(0)} data-testid="button-period-today">
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Total Cash Expense</p>
            <p className="text-xl font-bold tracking-tight tabular-nums" data-testid="text-cash-expense-total">
              {fmtAUD(summary?.total ?? 0)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{rows.length} entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">GST Estimate</p>
            <p className="text-xl font-bold tracking-tight tabular-nums" data-testid="text-cash-expense-gst">
              {fmtAUD(summary?.gstTotal ?? 0)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Recoverable input GST</p>
          </CardContent>
        </Card>
        <Card className={pendingRows.length > 0 ? "border-amber-300/60" : ""}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Pending Review</p>
            <p
              className={`text-xl font-bold tracking-tight tabular-nums ${pendingRows.length > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}
              data-testid="text-cash-expense-pending"
            >
              {pendingRows.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {pendingRows.length > 0 ? "Other/Unknown vendor entries" : "All approved"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pending highlight */}
      {pendingRows.length > 0 && (
        <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                Needs your review ({pendingRows.length})
              </h3>
            </div>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mb-3">
              Reassign to the real supplier (which sets the GST rate), or approve as Other/Unknown.
            </p>
            <div className="space-y-1.5">
              {pendingRows.map(r => (
                <CashExpenseRow
                  key={r.id}
                  row={r}
                  supplierName={supplierNameById.get(r.supplierId) ?? "(unknown)"}
                  isApproving={pendingApprove === r.id}
                  onEdit={() => setEditingExpense(r)}
                  onDelete={() => {
                    if (confirm("Delete this cash expense?")) deleteMutation.mutate(r.id);
                  }}
                  onApprove={() => approveMutation.mutate(r.id)}
                  variant="pending"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* By supplier */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
          <p className="text-sm">No cash expenses for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(summary?.bySupplier ?? []).map(group => {
            const supplierRows = rowsBySupplier.get(group.supplierId) ?? [];
            const isExpanded = expandedSuppliers.has(group.supplierId);
            const isOther = group.supplierName === OTHER_UNKNOWN_NAME;
            return (
              <Card key={group.supplierId} className={isOther ? "border-amber-300/40" : ""}>
                <button
                  type="button"
                  onClick={() => toggleSupplier(group.supplierId)}
                  className="w-full text-left p-3 hover:bg-muted/30 transition-colors flex items-center gap-3"
                  data-testid={`button-supplier-toggle-${group.supplierId}`}
                >
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-sm truncate">{group.supplierName}</span>
                      <span className="text-sm font-bold tabular-nums">{fmtAUD(group.total)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {group.count} {group.count === 1 ? "entry" : "entries"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        GST {fmtAUD(group.gst)}
                      </span>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-3 space-y-1.5 border-t">
                    {supplierRows.map(r => (
                      <CashExpenseRow
                        key={r.id}
                        row={r}
                        supplierName={group.supplierName}
                        isApproving={pendingApprove === r.id}
                        onEdit={() => setEditingExpense(r)}
                        onDelete={() => {
                          if (confirm("Delete this cash expense?")) deleteMutation.mutate(r.id);
                        }}
                        onApprove={() => approveMutation.mutate(r.id)}
                        variant={r.reviewStatus === "PENDING" ? "pending" : "approved"}
                      />
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editingExpense && (
        <EditCashExpenseDialog
          expense={editingExpense}
          suppliers={allSuppliers.filter(s => s.active !== false)}
          onClose={() => setEditingExpense(null)}
          onSaved={() => { setEditingExpense(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function CashExpenseRow({
  row,
  supplierName,
  variant,
  isApproving,
  onEdit,
  onDelete,
  onApprove,
}: {
  row: CashExpense;
  supplierName: string;
  variant: "pending" | "approved";
  isApproving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onApprove: () => void;
}) {
  const isPending = variant === "pending";
  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-2 rounded-md ${isPending ? "bg-amber-50/70 dark:bg-amber-950/30" : "bg-muted/30"}`}
      data-testid={`cash-expense-row-${row.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 justify-between">
          <span className="text-sm font-medium truncate">
            {isPending ? supplierName : row.expenseDate}
          </span>
          <span className="text-sm font-bold tabular-nums whitespace-nowrap">
            {fmtAUD(row.amount)}
          </span>
        </div>
        <div className="flex items-baseline gap-2 justify-between text-xs text-muted-foreground mt-0.5">
          <span className="truncate">
            {isPending ? row.expenseDate : (row.memo || "—")}
          </span>
          <span className="tabular-nums whitespace-nowrap">
            GST {fmtAUD(row.gstAmount)} ({row.gstRateSnapshot}%)
          </span>
        </div>
        {isPending && row.memo && (
          <p className="text-xs text-foreground/80 mt-1 italic">"{row.memo}"</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isPending && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onApprove}
            disabled={isApproving}
            data-testid={`button-approve-${row.id}`}
            className="h-7 px-2 text-xs gap-1"
          >
            {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Approve
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label="Edit"
          data-testid={`button-edit-${row.id}`}
          className="h-7 w-7"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          aria-label="Delete"
          data-testid={`button-delete-${row.id}`}
          className="h-7 w-7 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditCashExpenseDialog({
  expense,
  suppliers,
  onClose,
  onSaved,
}: {
  expense: CashExpense;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState<string>(expense.supplierId);
  const [amount, setAmount] = useState<string>(String(expense.amount));
  const [memo, setMemo] = useState<string>(expense.memo ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);

  const sortedSuppliers = useMemo(() => {
    const other = suppliers.find(s => s.name === OTHER_UNKNOWN_NAME);
    const rest = suppliers
      .filter(s => s.name !== OTHER_UNKNOWN_NAME)
      .sort((a, b) => a.name.localeCompare(b.name));
    return other ? [other, ...rest] : rest;
  }, [suppliers]);

  const selected = sortedSuppliers.find(s => s.id === supplierId);
  const isOther = selected?.name === OTHER_UNKNOWN_NAME;
  const memoValid = !isOther || memo.trim().length >= 3;
  const amountNum = parseFloat(amount);
  const canSave = supplierId && Number.isFinite(amountNum) && amountNum >= 0 && memoValid;

  const previewGst = useMemo(() => {
    if (!selected || !Number.isFinite(amountNum) || amountNum <= 0) return 0;
    const rate = selected.defaultGstRate ?? 0;
    return rate > 0 ? Math.round((amountNum * rate / 100 / 11) * 100) / 100 : 0;
  }, [amountNum, selected]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Server re-snapshots GST when supplierId or amount changes; reviewStatus
      // is preserved unless it's a PENDING→APPROVED transition (handled elsewhere).
      await apiRequest("PATCH", `/api/cash-expenses/${expense.id}`, {
        supplierId,
        amount: amountNum,
        memo: memo.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      onSaved();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit cash expense</DialogTitle>
          <DialogDescription>
            Reassigning the supplier re-snapshots the GST rate ({selected?.defaultGstRate ?? 0}%).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="button-edit-supplier-picker"
                >
                  {selected ? selected.name : "Choose supplier…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="p-0"
                style={{ width: "var(--radix-popover-trigger-width)" }}
              >
                <Command>
                  <CommandInput placeholder="Search…" />
                  <CommandList>
                    <CommandEmpty>No supplier found.</CommandEmpty>
                    <CommandGroup>
                      {sortedSuppliers.map(s => {
                        const other = s.name === OTHER_UNKNOWN_NAME;
                        return (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => { setSupplierId(s.id); setPickerOpen(false); }}
                            data-testid={`option-edit-supplier-${s.id}`}
                          >
                            <Check className={`mr-2 h-4 w-4 ${supplierId === s.id ? "opacity-100" : "opacity-0"}`} />
                            <span className={other ? "font-semibold" : ""}>{s.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                              {s.defaultGstRate ?? 0}%
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (AUD)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-edit-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label>GST estimate</Label>
              <div className="h-10 px-3 flex items-center rounded-md border bg-muted/30 text-sm tabular-nums">
                {selected ? `${fmtAUD(previewGst)} (${selected.defaultGstRate ?? 0}%)` : "—"}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Memo {isOther && <span className="text-xs text-amber-700 dark:text-amber-400">(required, 3+ chars)</span>}</Label>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              data-testid="input-edit-memo"
              placeholder={isOther ? "Where & what was bought" : "Optional note"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
            data-testid="button-save-edit"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
