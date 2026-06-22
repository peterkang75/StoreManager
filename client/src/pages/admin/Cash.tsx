import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wallet, Receipt, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, Pencil, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Store, DailyClosing, DailyCloseForm, CashExpense, Supplier } from "@shared/schema";
import { STORE_COLORS as STORE_BRAND } from "@shared/storeColors";
import { useAdminRole } from "@/contexts/AdminRoleContext";

// ─── Date helpers (local-calendar, no UTC drift) ────────────────────────────
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}
function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + n);
  return toYMD(d);
}
function fmtWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function fmtRowDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const dow = d.toLocaleDateString("en-AU", { weekday: "short" });
  return `${dd}/${mm}/${yy}, ${dow}`;
}

// Edit form mirrors the editable surface of a DailyClosing. Numeric fields
// are kept as strings while typing; we coerce on submit. creditAmount and
// differenceAmount are recomputed live from the inputs on save.
type EditFields = {
  date: string;
  storeId: string;
  staffNames: string;
  previousFloat: string;
  salesTotal: string;
  cashSales: string;
  cashOut: string;
  actualCashCounted: string;
  nextFloat: string;
  ubereatsAmount: string;
  doordashAmount: string;
  notes: string;
};

function closingToEditFields(c: DailyClosing): EditFields {
  return {
    date: c.date,
    storeId: c.storeId,
    staffNames: c.staffNames ?? "",
    previousFloat: String(c.previousFloat ?? 0),
    salesTotal: String(c.salesTotal ?? 0),
    cashSales: String(c.cashSales ?? 0),
    cashOut: String(c.cashOut ?? 0),
    actualCashCounted: String(c.actualCashCounted ?? 0),
    nextFloat: String(c.nextFloat ?? 0),
    ubereatsAmount: String(c.ubereatsAmount ?? 0),
    doordashAmount: String(c.doordashAmount ?? 0),
    notes: c.notes ?? "",
  };
}

const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// One labelled $-amount line in the expanded detail panel. `muted` softens
// the row (used for sub-components that roll up into a parent total),
// `bold` highlights the rolled-up total itself.
function DetailRow({ label, value, muted, bold }: { label: string; value: number; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${bold ? "font-bold" : muted ? "text-muted-foreground" : "font-medium"}`}>
        ${value.toFixed(2)}
      </span>
    </div>
  );
}

export function AdminCash() {
  const { currentRole } = useAdminRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // §7 Wave 1 Day 6: page is single-store now (no "All Stores" aggregation).
  // Empty initial value gets resolved to the Sushi store once /api/stores
  // loads; falling back to the first eligible store keeps the UI usable
  // even on a non-Sushi tenant.
  const [storeFilter, setStoreFilter] = useState<string>("");
  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const startDate = weekStart;
  const endDate = weekEnd;

  const [editing, setEditing] = useState<{ id: string; fields: EditFields } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DailyClosing | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  // Cash & Daily Close is only relevant to Sushi + Sandwich operations.
  const activeStores = useMemo(
    () => (stores ?? []).filter(s => s.active && /sushi|sandwich/i.test(s.name)),
    [stores],
  );

  // Default the filter to the Sushi store the moment the list arrives.
  useEffect(() => {
    if (storeFilter !== "" || activeStores.length === 0) return;
    const sushi = activeStores.find(s => /sushi/i.test(s.name));
    setStoreFilter((sushi ?? activeStores[0]).id);
  }, [activeStores, storeFilter]);

  const { data: dailyClosings, isLoading: closingsLoading } = useQuery<DailyClosing[]>({
    queryKey: ["/api/daily-closings", storeFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("store_id", storeFilter);
      params.append("start_date", startDate);
      params.append("end_date", endDate);
      const res = await fetch(`/api/daily-closings?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: storeFilter !== "",
  });

  // Cash Details now reads from daily_close_forms — the same record the
  // mobile flow already writes (denominations + envelope + counted). No
  // separate cashSalesDetails write path is needed.
  const { data: closeForms, isLoading: cashLoading } = useQuery<DailyCloseForm[]>({
    queryKey: ["/api/daily-close-forms", storeFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("storeId", storeFilter);
      params.append("startDate", startDate);
      params.append("endDate", endDate);
      const res = await fetch(`/api/daily-close-forms?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: currentRole !== "MANAGER" && storeFilter !== "",
  });

  // §7 Wave 1 Day 6: per-supplier cash out breakdown for the expanded row.
  // Same store + week window so the join in render is just a date lookup.
  const { data: cashExpenses } = useQuery<CashExpense[]>({
    queryKey: ["/api/cash-expenses", storeFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("storeId", storeFilter);
      params.append("from", startDate);
      params.append("to", endDate);
      const res = await fetch(`/api/cash-expenses?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: storeFilter !== "",
  });

  // Supplier names for the cash-out breakdown labels. Admin-side already so
  // /api/suppliers (admin-gated) is fine here.
  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers ?? []) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  // Group cash expenses by date for fast per-row lookup.
  const cashExpensesByDate = useMemo(() => {
    const m = new Map<string, CashExpense[]>();
    for (const e of cashExpenses ?? []) {
      const arr = m.get(e.expenseDate) ?? [];
      arr.push(e);
      m.set(e.expenseDate, arr);
    }
    return m;
  }, [cashExpenses]);

  // §6.3.13 Per-week totals row — weekday (Mon–Fri), weekend (Sat–Sun), total.
  // Caps inclusion at "today" so a mid-week view shows running totals, not
  // projected ones from days that haven't happened yet.
  const todayStr = toYMD(new Date());
  const weeklyTotals = useMemo(() => {
    type Bucket = { totalIncome: number; posSales: number; delivery: number; eftpos: number; cashSales: number; credit: number };
    const init = (): Bucket => ({ totalIncome: 0, posSales: 0, delivery: 0, eftpos: 0, cashSales: 0, credit: 0 });
    const weekday = init();
    const weekend = init();
    const total = init();
    for (const c of dailyClosings ?? []) {
      if (c.date > todayStr) continue;
      const delivery = c.ubereatsAmount + c.doordashAmount;
      const eftpos = Math.max(0, c.salesTotal - c.cashSales);
      const totalIncome = c.salesTotal + delivery;
      const credit = c.actualCashCounted;
      const dow = new Date(c.date + "T00:00:00").getDay(); // 0=Sun, 6=Sat
      const bucket = dow === 0 || dow === 6 ? weekend : weekday;
      bucket.totalIncome += totalIncome;
      bucket.posSales += c.salesTotal;
      bucket.delivery += delivery;
      bucket.eftpos += eftpos;
      bucket.cashSales += c.cashSales;
      bucket.credit += credit;
      total.totalIncome += totalIncome;
      total.posSales += c.salesTotal;
      total.delivery += delivery;
      total.eftpos += eftpos;
      total.cashSales += c.cashSales;
      total.credit += credit;
    }
    return { weekday, weekend, total };
  }, [dailyClosings, todayStr]);

  const getStoreName = (storeId: string) => {
    return stores?.find(s => s.id === storeId)?.name || "-";
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: EditFields }) => {
      const f = vars.fields;
      const previousFloat = num(f.previousFloat);
      const salesTotal = num(f.salesTotal);
      const cashSales = num(f.cashSales);
      const cashOut = num(f.cashOut);
      const nextFloat = num(f.nextFloat);
      const actualCashCounted = num(f.actualCashCounted);
      const creditAmount = previousFloat + cashSales - cashOut - nextFloat;
      const differenceAmount = creditAmount - actualCashCounted;
      const body = {
        date: f.date,
        storeId: f.storeId,
        staffNames: f.staffNames || null,
        previousFloat,
        salesTotal,
        cashSales,
        cashOut,
        nextFloat,
        actualCashCounted,
        creditAmount,
        differenceAmount,
        ubereatsAmount: num(f.ubereatsAmount),
        doordashAmount: num(f.doordashAmount),
        notes: f.notes || null,
      };
      await apiRequest("PUT", `/api/daily-closings/${vars.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setEditing(null);
      toast({ title: "Daily closing updated" });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/daily-closings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setConfirmDelete(null);
      toast({ title: "Daily closing deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete entry", variant: "destructive" });
    },
  });

  const isLoading = closingsLoading || cashLoading;

  if (isLoading) {
    return (
      <AdminLayout title="Cash & Daily Close">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  // Live-computed credit + difference inside the edit dialog so the user
  // can see the impact of their edits before saving.
  const editPreview = (() => {
    if (!editing) return null;
    const f = editing.fields;
    const credit = num(f.previousFloat) + num(f.cashSales) - num(f.cashOut) - num(f.nextFloat);
    const diff = credit - num(f.actualCashCounted);
    return { credit, diff };
  })();

  return (
    <AdminLayout title="Cash & Daily Close">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
              <CardTitle className="text-sm sm:text-base">Filter</CardTitle>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
                <div className="flex items-center gap-1 flex-wrap">
                  {activeStores.map(store => {
                    const isActive = storeFilter === store.id;
                    const brandColor = STORE_BRAND[store.name] ?? null;
                    return (
                      <button
                        key={store.id}
                        onClick={() => setStoreFilter(store.id)}
                        className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium border transition-colors ${
                          isActive ? "text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                        }`}
                        style={isActive ? { backgroundColor: brandColor ?? "#1a1a1a" } : {}}
                        data-testid={`button-store-filter-${store.id}`}
                      >
                        {store.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center border rounded-md ml-auto sm:ml-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 sm:h-10 sm:w-10"
                    onClick={() => setWeekStart(addDays(weekStart, -7))}
                    data-testid="button-prev-week"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-1.5 sm:px-2 text-xs sm:text-sm font-medium whitespace-nowrap" data-testid="text-week-range">
                    {fmtWeekLabel(weekStart)} – {fmtWeekLabel(weekEnd)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 sm:h-10 sm:w-10"
                    onClick={() => setWeekStart(addDays(weekStart, 7))}
                    data-testid="button-next-week"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="closings">
          <TabsList>
            <TabsTrigger value="closings" data-testid="tab-closings">
              <Receipt className="w-4 h-4 mr-2" />
              Daily Closings
            </TabsTrigger>
            {currentRole !== "MANAGER" && (
              <TabsTrigger value="cash" data-testid="tab-cash">
                <Wallet className="w-4 h-4 mr-2" />
                Cash Details
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="closings">
            <Card>
              <CardContent className="pt-6">
                {!dailyClosings?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {currentRole === "MANAGER"
                        ? "No daily closings yet."
                        : "No daily closings yet."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Date</TableHead>
                          <TableHead>Staff</TableHead>
                          <TableHead className="text-right">Total Income</TableHead>
                          <TableHead className="text-right">POS Sales Total</TableHead>
                          <TableHead className="text-right">Delivery Total</TableHead>
                          <TableHead className="text-right">EFTPOS Total</TableHead>
                          <TableHead className="text-right">Cash Sales Total</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* §6.3.13 Weekly running totals — weekday / weekend / total, capped at today */}
                        {([
                          { label: "Weekday Total", bucket: weeklyTotals.weekday, testid: "row-totals-weekday" },
                          { label: "Weekend Total", bucket: weeklyTotals.weekend, testid: "row-totals-weekend" },
                          { label: "Grand Total",   bucket: weeklyTotals.total,   testid: "row-totals-all"     },
                        ] as const).map((t, idx) => (
                          <TableRow
                            key={t.testid}
                            data-testid={t.testid}
                            className={`bg-muted/40 hover:bg-muted/40 ${idx === 2 ? "border-b-2" : ""}`}
                          >
                            <TableCell className="w-8 px-2" />
                            <TableCell
                              colSpan={2}
                              className={`text-xs uppercase tracking-wide text-muted-foreground ${idx === 2 ? "font-semibold text-foreground" : ""}`}
                            >
                              {t.label}
                            </TableCell>
                            <TableCell className={`text-right tabular-nums ${idx === 2 ? "font-semibold" : ""}`}>
                              ${t.bucket.totalIncome.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">${t.bucket.posSales.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">${t.bucket.delivery.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">${t.bucket.eftpos.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">${t.bucket.cashSales.toFixed(2)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${idx === 2 ? "font-semibold" : ""}`}>
                              ${t.bucket.credit.toFixed(2)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        ))}
                        {[...dailyClosings].sort((a, b) => a.date.localeCompare(b.date)).map(closing => {
                          const isShortage = closing.differenceAmount > 0.005;
                          const isOverage = closing.differenceAmount < -0.005;
                          // POS Sales Total already aggregates cash + EFTPOS at the
                          // till; isolate the EFTPOS portion by subtracting the cash
                          // half so each table column is independent.
                          const eftposTotal = Math.max(0, closing.salesTotal - closing.cashSales);
                          const deliveryTotal = closing.ubereatsAmount + closing.doordashAmount;
                          const totalIncome = closing.salesTotal + deliveryTotal;
                          const isExpanded = expandedRows.has(closing.id);
                          const expenses = cashExpensesByDate.get(closing.date) ?? [];
                          return (
                            <Fragment key={closing.id}>
                              <TableRow
                                data-testid={`row-closing-${closing.id}`}
                                className="cursor-pointer hover:bg-muted/30"
                                onClick={() => toggleRow(closing.id)}
                              >
                                <TableCell className="w-8 px-2">
                                  <ChevronDown
                                    className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                                  />
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{fmtRowDate(closing.date)}</TableCell>
                                <TableCell className="max-w-[150px] truncate">{closing.staffNames || "-"}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">${totalIncome.toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">${closing.salesTotal.toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">${deliveryTotal.toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">${eftposTotal.toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">${closing.cashSales.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-medium tabular-nums">${closing.actualCashCounted.toFixed(2)}</TableCell>
                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="inline-flex gap-1">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      onClick={() => setEditing({ id: closing.id, fields: closingToEditFields(closing) })}
                                      data-testid={`button-edit-${closing.id}`}
                                      aria-label="Edit"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                      onClick={() => setConfirmDelete(closing)}
                                      data-testid={`button-delete-${closing.id}`}
                                      aria-label="Delete"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow className="bg-muted/30 hover:bg-muted/30">
                                  <TableCell colSpan={10} className="p-0">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-4" data-testid={`detail-${closing.id}`}>
                                      {/* Sales breakdown */}
                                      <div className="space-y-2">
                                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sales Breakdown</p>
                                        <DetailRow label="POS Sales (cash + EFTPOS)" value={closing.salesTotal} />
                                        <DetailRow label="EFTPOS portion" value={eftposTotal} muted />
                                        <DetailRow label="Cash Sales portion" value={closing.cashSales} muted />
                                        <DetailRow label="UberEats" value={closing.ubereatsAmount} muted />
                                        <DetailRow label="DoorDash" value={closing.doordashAmount} muted />
                                        <DetailRow label="Total Income" value={totalIncome} bold />
                                      </div>

                                      {/* Cash flow */}
                                      <div className="space-y-2">
                                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Cash Flow</p>
                                        <DetailRow label="Previous Float" value={closing.previousFloat} />
                                        <DetailRow label="+ Cash Sales (in)" value={closing.cashSales} muted />
                                        <div className="space-y-1">
                                          <DetailRow label="− Cash Out" value={closing.cashOut} />
                                          {expenses.length > 0 && (
                                            <ul className="ml-4 space-y-0.5 text-xs text-muted-foreground">
                                              {expenses.map(e => (
                                                <li key={e.id} className="flex items-baseline justify-between gap-3">
                                                  <span className="truncate">
                                                    {supplierNameById.get(e.supplierId) ?? "(unknown)"}
                                                    {e.reviewStatus === "PENDING" && (
                                                      <span className="ml-1.5 text-[10px] uppercase text-amber-700 dark:text-amber-400">pending</span>
                                                    )}
                                                    {e.memo && <span className="ml-1.5 italic">"{e.memo}"</span>}
                                                  </span>
                                                  <span className="tabular-nums whitespace-nowrap">${e.amount.toFixed(2)}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                        <DetailRow label="− Next Float" value={closing.nextFloat} muted />
                                        <DetailRow label="= Expected Cash" value={closing.creditAmount} />
                                        <DetailRow label="Counted (Credit)" value={closing.actualCashCounted} bold />
                                        <div className="flex items-baseline justify-between pt-1 border-t" data-testid={`text-diff-${closing.id}`}>
                                          <span className="text-sm font-medium">Difference</span>
                                          {isShortage ? (
                                            <span className="inline-flex items-center gap-1 text-red-600 font-bold tabular-nums">
                                              <AlertTriangle className="w-3 h-3" />
                                              ${closing.differenceAmount.toFixed(2)} <span className="text-xs font-normal">(shortage)</span>
                                            </span>
                                          ) : isOverage ? (
                                            <span className="text-green-600 font-medium tabular-nums">
                                              +${Math.abs(closing.differenceAmount).toFixed(2)} <span className="text-xs font-normal">(overage)</span>
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground tabular-nums">$0.00</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {currentRole !== "MANAGER" && (
          <TabsContent value="cash">
            <Card>
              <CardContent className="pt-6">
                {!closeForms?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No cash sales records found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Submitter</TableHead>
                          <TableHead className="text-right">Envelope</TableHead>
                          <TableHead className="text-right">$100</TableHead>
                          <TableHead className="text-right">$50</TableHead>
                          <TableHead className="text-right">$20</TableHead>
                          <TableHead className="text-right">$10</TableHead>
                          <TableHead className="text-right">$5</TableHead>
                          <TableHead className="text-right">Counted</TableHead>
                          <TableHead className="text-right">Diff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...closeForms].sort((a, b) => a.date.localeCompare(b.date)).map(f => {
                          const envelope = f.envelopeAmount ?? 0;
                          const counted = f.totalCalculated ?? 0;
                          const diff = counted - envelope;
                          return (
                            <TableRow key={f.id} data-testid={`row-cash-${f.id}`}>
                              <TableCell>{f.date}</TableCell>
                              <TableCell className="max-w-[150px] truncate">{f.submitterName || "-"}</TableCell>
                              <TableCell className="text-right">${envelope.toFixed(2)}</TableCell>
                              <TableCell className="text-right">{f.note100Count}</TableCell>
                              <TableCell className="text-right">{f.note50Count}</TableCell>
                              <TableCell className="text-right">{f.note20Count}</TableCell>
                              <TableCell className="text-right">{f.note10Count}</TableCell>
                              <TableCell className="text-right">{f.note5Count}</TableCell>
                              <TableCell className="text-right">${counted.toFixed(2)}</TableCell>
                              <TableCell className={`text-right font-medium ${diff !== 0 ? (diff > 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                                {diff !== 0 && (diff > 0 ? '+' : '')}${diff.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Daily Closing</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-date">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editing.fields.date}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, date: e.target.value } })}
                  data-testid="input-edit-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-store">Store</Label>
                <Select
                  value={editing.fields.storeId}
                  onValueChange={(v) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, storeId: v } })}
                >
                  <SelectTrigger id="edit-store" data-testid="select-edit-store">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(stores ?? []).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="edit-staff">Staff</Label>
                <Input
                  id="edit-staff"
                  value={editing.fields.staffNames}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, staffNames: e.target.value } })}
                  data-testid="input-edit-staff"
                />
              </div>
              {([
                ["previousFloat", "Previous Float"],
                ["salesTotal", "POS Sales Total"],
                ["cashSales", "Cash Amount"],
                ["cashOut", "Cash Out"],
                ["actualCashCounted", "Credit"],
                ["nextFloat", "Next Float"],
                ["ubereatsAmount", "Uber"],
                ["doordashAmount", "DoorDash"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`edit-${key}`}>{label}</Label>
                  <Input
                    id={`edit-${key}`}
                    type="text"
                    inputMode="decimal"
                    value={editing.fields[key]}
                    onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, [key]: e.target.value } })}
                    data-testid={`input-edit-${key}`}
                  />
                </div>
              ))}
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editing.fields.notes}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, notes: e.target.value } })}
                  data-testid="input-edit-notes"
                />
              </div>
              {editPreview && (
                <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-md border bg-muted/40 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Expected Cash (computed)</p>
                    <p className="text-base font-semibold">${editPreview.credit.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Difference (computed)</p>
                    <p className={`text-base font-semibold ${editPreview.diff > 0.005 ? "text-red-600" : editPreview.diff < -0.005 ? "text-green-600" : ""}`}>
                      ${editPreview.diff.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} data-testid="button-edit-cancel">Cancel</Button>
            <Button
              onClick={() => editing && updateMutation.mutate(editing)}
              disabled={!editing || updateMutation.isPending}
              data-testid="button-edit-save"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this daily closing?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  This will permanently remove the {confirmDelete.date} entry for {getStoreName(confirmDelete.storeId)} and the matching cash-detail row. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
