import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Save, Printer, FileSpreadsheet, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, User, RotateCcw, Landmark, CheckCircle2, Circle, ArrowRightLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CashBalances } from "@/components/CashBalances";
import { ConvertForm } from "@/components/ConvertForm";
import type { Store, Employee, Payroll } from "@shared/schema";
import { Calculator } from "lucide-react";

const CASH_DENOMINATIONS = [100, 50, 20, 10, 5] as const;

function CashCounter() {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});

  const total = CASH_DENOMINATIONS.reduce((sum, d) => sum + (counts[d] || 0) * d, 0);

  const handleChange = (denom: number, val: string) => {
    const n = parseInt(val) || 0;
    setCounts((prev) => ({ ...prev, [denom]: n }));
  };

  const handleReset = () => setCounts({});

  return (
    <Card>
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
        data-testid="button-toggle-cash-counter"
      >
        <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">Cash Counter</span>
        {total > 0 && (
          <Badge variant="secondary" className="ml-1">
            ${total.toLocaleString()}
          </Badge>
        )}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        )}
      </div>
      {open && (
        <CardContent className="pt-0 pb-3">
          <div className="flex items-end gap-3 flex-wrap">
            {CASH_DENOMINATIONS.map((d) => (
              <div key={d} className="space-y-1">
                <Label className="text-xs text-muted-foreground">${d}</Label>
                <Input
                  type="number"
                  min="0"
                  className="w-20 text-center"
                  value={counts[d] || ""}
                  onChange={(e) => handleChange(d, e.target.value)}
                  placeholder="0"
                  data-testid={`input-cash-count-${d}`}
                />
              </div>
            ))}
            <div className="flex items-center gap-2 ml-2">
              <span className="text-lg font-bold font-mono" data-testid="text-cash-counter-total">
                ${total.toLocaleString("en-AU", { minimumFractionDigits: 2 })}
              </span>
              <Button size="icon" variant="ghost" onClick={handleReset} data-testid="button-reset-cash-counter">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function getLastFortnight(): { start: string; end: string } {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysToLastSunday);
  const fortnightStart = new Date(lastSunday);
  fortnightStart.setDate(lastSunday.getDate() - 13);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { start: fmt(fortnightStart), end: fmt(lastSunday) };
}

function calculatePaygTax(fortnightlyGross: number): number {
  if (fortnightlyGross < 722) return 0;
  const x = fortnightlyGross + 0.99;

  const brackets: [number, number, number][] = [
    [1730, 0.1600, 116.33],
    [5192, 0.3200, 354.31],
    [Infinity, 0.3900, 717.77],
  ];

  for (const [upper, a, b] of brackets) {
    if (fortnightlyGross < upper) {
      return Math.max(0, Math.round(a * x - b));
    }
  }
  return 0;
}

const SUPER_RATE = 0.115;

interface PayrollRow {
  employeeId: string;
  employeeName: string;
  payrollId: string | null;
  hours: number;
  rate: number;
  fixedAmount: number;
  calculatedAmount: number;
  adjustment: number;
  adjustmentReason: string;
  totalWithAdjustment: number;
  grossAmount: number;
  cashAmount: number;
  taxAmount: number;
  superAmount: number;
  bankDepositAmount: number;
  persistentMemo: string;
  lastEditedField: "gross" | "cash" | null;
  taxOverridden: boolean;
  isCover: boolean;
  // Intercompany settlement fields
  isIntercompany: boolean;
  intercompanyAmount: number;  // apportioned share of the fixed salary this store owes
  totalAllStoreHours: number;  // for display (ratio denominator)
}

interface ApprovedShift {
  employeeId: string;
  storeId: string;
  date: string;
  actualStartTime: string;
  actualEndTime: string;
  status: string;
}

function roundTo5(v: number): number {
  return Math.round(v / 5) * 5;
}

function recalcRow(row: PayrollRow, changedField?: string): PayrollRow {
  const r = { ...row };
  r.calculatedAmount = r.fixedAmount > 0 ? r.fixedAmount : r.hours * r.rate;
  r.totalWithAdjustment = r.calculatedAmount + r.adjustment;

  if (changedField === "grossAmount") {
    r.cashAmount = roundTo5(Math.max(0, r.totalWithAdjustment - r.grossAmount));
    r.lastEditedField = "gross";
  } else if (changedField === "cashAmount") {
    r.grossAmount = Math.max(0, r.totalWithAdjustment - r.cashAmount);
    r.lastEditedField = "cash";
  } else if (r.lastEditedField === "gross") {
    r.cashAmount = roundTo5(Math.max(0, r.totalWithAdjustment - r.grossAmount));
  } else if (r.lastEditedField === "cash") {
    r.grossAmount = Math.max(0, r.totalWithAdjustment - r.cashAmount);
  } else {
    r.cashAmount = roundTo5(r.totalWithAdjustment);
    r.grossAmount = 0;
  }

  r.superAmount = Math.round(r.grossAmount * SUPER_RATE * 100) / 100;

  if (changedField === "taxAmount") {
    r.taxOverridden = true;
  } else if (!r.taxOverridden) {
    r.taxAmount = calculatePaygTax(r.grossAmount);
  }

  r.bankDepositAmount = Math.max(0, r.grossAmount - r.taxAmount);

  return r;
}

export function AdminPayrolls() {
  const { toast } = useToast();
  const fortnight = getLastFortnight();
  const [periodStart, setPeriodStart] = useState(fortnight.start);
  const [periodEnd, setPeriodEnd] = useState(fortnight.end);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [globalNote, setGlobalNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [bankTrackerOpen, setBankTrackerOpen] = useState(false);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: cashBalances } = useQuery<Record<string, number>>({
    queryKey: ["/api/finance/balances"],
  });

  const storeOrder = ["sushi", "sandwich", "ho"];
  const activeInternalStores = (stores || [])
    .filter((s) => s.active && !s.isExternal && s.name.toLowerCase() !== "trading")
    .sort((a, b) => {
      const ai = storeOrder.indexOf(a.name.toLowerCase());
      const bi = storeOrder.indexOf(b.name.toLowerCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  useEffect(() => {
    if (activeInternalStores.length > 0 && !selectedStoreId) {
      setSelectedStoreId(activeInternalStores[0].id);
    }
  }, [activeInternalStores, selectedStoreId]);

  const selectedStore = stores?.find((s) => s.id === selectedStoreId);

  useEffect(() => {
    if (selectedStore && !noteLoaded) {
      setGlobalNote(selectedStore.globalPayrollNote || "");
      setNoteLoaded(true);
    }
  }, [selectedStore, noteLoaded]);

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
    const store = stores?.find((s) => s.id === storeId);
    setGlobalNote(store?.globalPayrollNote || "");
    setRows([]);
  };

  const { data: currentData, isLoading: dataLoading } = useQuery<
    { employee: Employee; payroll: Payroll | null }[]
  >({
    queryKey: ["/api/payrolls/current", selectedStoreId, periodStart, periodEnd],
    queryFn: async () => {
      if (!selectedStoreId || !periodStart || !periodEnd) return [];
      const params = new URLSearchParams({
        store_id: selectedStoreId,
        period_start: periodStart,
        period_end: periodEnd,
      });
      const res = await fetch(`/api/payrolls/current?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedStoreId && !!periodStart && !!periodEnd,
  });

  const { data: approvedShifts = [] } = useQuery<ApprovedShift[]>({
    queryKey: ["/api/admin/approvals", "ALL"],
    queryFn: () => fetch("/api/admin/approvals?status=ALL").then((r) => r.json()),
    staleTime: 30000,
  });

  const approvedHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ts of approvedShifts) {
      if (ts.status !== "APPROVED") continue;
      if (ts.storeId !== selectedStoreId) continue;
      if (ts.date < periodStart || ts.date > periodEnd) continue;
      const [sh, sm] = ts.actualStartTime.split(":").map(Number);
      const [eh, em] = ts.actualEndTime.split(":").map(Number);
      const diffMins = eh * 60 + em - (sh * 60 + sm);
      const hrs = (diffMins < 0 ? diffMins + 1440 : diffMins) / 60;
      map[ts.employeeId] = Math.round(((map[ts.employeeId] || 0) + hrs) * 100) / 100;
    }
    return map;
  }, [approvedShifts, selectedStoreId, periodStart, periodEnd]);

  // Total approved hours across ALL stores for each employee (used for intercompany ratio)
  const totalAllStoreHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ts of approvedShifts) {
      if (ts.status !== "APPROVED") continue;
      if (ts.date < periodStart || ts.date > periodEnd) continue;
      const [sh, sm] = ts.actualStartTime.split(":").map(Number);
      const [eh, em] = ts.actualEndTime.split(":").map(Number);
      const diffMins = eh * 60 + em - (sh * 60 + sm);
      const hrs = (diffMins < 0 ? diffMins + 1440 : diffMins) / 60;
      map[ts.employeeId] = Math.round(((map[ts.employeeId] || 0) + hrs) * 100) / 100;
    }
    return map;
  }, [approvedShifts, periodStart, periodEnd]);

  useEffect(() => {
    if (!currentData) return;
    const newRows: PayrollRow[] = currentData.map(({ employee, payroll }) => {
      const empRate = parseFloat(employee.rate || "0");
      const empFixed = parseFloat((employee as any).fixedAmount || "0");
      const empIsCover = !!(employee as any).isCover;
      const isFixedSalaryHere = !!(employee as any).isFixedSalaryAtThisStore;

      // Intercompany detection: employee has a fixed salary, but this store is NOT the primary payer,
      // AND the employee has approved hours at other stores during this period.
      const currentHours = approvedHoursMap[employee.id] ?? 0;
      const totalHours = totalAllStoreHoursMap[employee.id] ?? 0;
      const hasOtherStoreHours = totalHours > currentHours + 0.01;
      const isIntercompany = !isFixedSalaryHere && empFixed > 0 && hasOtherStoreHours;

      // Apportioned cost = (this store's hours / total hours) * fixed salary
      const intercompanyAmount = isIntercompany && totalHours > 0
        ? Math.round(empFixed * (currentHours / totalHours) * 100) / 100
        : 0;

      if (payroll) {
        const isIntercompanyPayroll = !isFixedSalaryHere && empFixed > 0 && hasOtherStoreHours;
        const icAmtPayroll = isIntercompanyPayroll && totalHours > 0
          ? Math.round(empFixed * (currentHours / totalHours) * 100) / 100
          : 0;
        return {
          employeeId: employee.id,
          employeeName: (employee as any).nickname || `${(employee as any).firstName} ${(employee as any).lastName}`,
          payrollId: payroll.id,
          hours: payroll.hours,
          rate: payroll.rate || empRate,
          fixedAmount: isIntercompanyPayroll ? 0 : (payroll.fixedAmount || empFixed),
          calculatedAmount: payroll.calculatedAmount,
          adjustment: payroll.adjustment,
          adjustmentReason: payroll.adjustmentReason || "",
          totalWithAdjustment: payroll.totalWithAdjustment,
          grossAmount: payroll.grossAmount,
          cashAmount: payroll.cashAmount,
          taxAmount: payroll.taxAmount,
          superAmount: payroll.superAmount,
          bankDepositAmount: payroll.bankDepositAmount,
          persistentMemo: (employee as any).persistentMemo || "",
          lastEditedField: null,
          taxOverridden: false,
          isCover: empIsCover,
          isIntercompany: isIntercompanyPayroll,
          intercompanyAmount: icAmtPayroll,
          totalAllStoreHours: totalHours,
        };
      }

      const base: PayrollRow = {
        employeeId: employee.id,
        employeeName: (employee as any).nickname || `${(employee as any).firstName} ${(employee as any).lastName}`,
        payrollId: null,
        hours: currentHours,
        rate: empRate,
        // For intercompany employees at secondary stores, fixedAmount=0 so they aren't paid directly
        fixedAmount: isIntercompany ? 0 : empFixed,
        calculatedAmount: 0,
        adjustment: 0,
        adjustmentReason: "",
        totalWithAdjustment: 0,
        grossAmount: 0,
        cashAmount: 0,
        taxAmount: 0,
        superAmount: 0,
        bankDepositAmount: 0,
        persistentMemo: (employee as any).persistentMemo || "",
        lastEditedField: null,
        taxOverridden: false,
        isCover: empIsCover,
        isIntercompany,
        intercompanyAmount,
        totalAllStoreHours: totalHours,
      };
      return recalcRow(base);
    });
    setRows(newRows);
  }, [currentData, approvedHoursMap, totalAllStoreHoursMap]);

  const updateRow = useCallback(
    (index: number, field: keyof PayrollRow, value: number | string) => {
      setRows((prev) => {
        const updated = [...prev];
        const row = { ...updated[index], [field]: value };
        updated[index] = recalcRow(row, field);
        return updated;
      });
    },
    []
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payloadRows = rows.map((r) => ({
        id: r.payrollId || undefined,
        employeeId: r.employeeId,
        storeId: selectedStoreId || undefined,
        periodStart,
        periodEnd,
        hours: r.hours,
        rate: r.rate,
        fixedAmount: r.fixedAmount,
        calculatedAmount: r.calculatedAmount,
        adjustment: r.adjustment,
        adjustmentReason: r.adjustmentReason || null,
        totalWithAdjustment: r.totalWithAdjustment,
        grossAmount: r.grossAmount,
        cashAmount: r.cashAmount,
        taxAmount: r.taxAmount,
        superAmount: r.superAmount,
        bankDepositAmount: r.bankDepositAmount,
        memo: null,
      }));

      const memoUpdates = rows
        .filter((r) => r.persistentMemo !== undefined)
        .map((r) =>
          apiRequest("PUT", `/api/employees/${r.employeeId}`, {
            persistentMemo: r.persistentMemo || null,
          })
        );

      const [payrollResult] = await Promise.all([
        apiRequest("POST", "/api/payrolls/bulk", { rows: payloadRows }).then(
          (r) => r.json()
        ),
        ...memoUpdates,
        selectedStoreId
          ? apiRequest("PUT", `/api/stores/${selectedStoreId}/payroll-note`, {
              globalPayrollNote: globalNote || null,
            })
          : Promise.resolve(),
      ]);
      return payrollResult;
    },
    onSuccess: () => {
      toast({ title: "Payroll saved successfully" });
      queryClient.invalidateQueries({
        queryKey: ["/api/payrolls/current", selectedStoreId, periodStart, periodEnd],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  interface BankDepositEntry {
    payrollId: string;
    employeeName: string;
    bsb: string;
    accountNo: string;
    storeName: string;
    storeId: string | null;
    bankDepositAmount: number;
    isBankTransferDone: boolean;
    bankTransferDate: string | null;
  }

  const { data: bankDeposits, isLoading: bankDepositsLoading, refetch: refetchBankDeposits } = useQuery<BankDepositEntry[]>({
    queryKey: ["/api/payrolls/bank-deposits", periodStart, periodEnd],
    queryFn: async () => {
      const qs = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
      const res = await fetch(`/api/payrolls/bank-deposits?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch bank deposits");
      return res.json();
    },
    enabled: bankTrackerOpen,
  });

  const bankTransferMutation = useMutation({
    mutationFn: async ({ payrollId, isBankTransferDone }: { payrollId: string; isBankTransferDone: boolean }) => {
      return apiRequest("PATCH", `/api/payrolls/${payrollId}/bank-transfer-status`, { isBankTransferDone });
    },
    onSuccess: () => {
      refetchBankDeposits();
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls/bank-deposits", periodStart, periodEnd] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const shiftPeriod = (direction: number) => {
    const days = 14 * direction;
    const shift = (dateStr: string) => {
      const d = new Date(dateStr);
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    setPeriodStart(shift(periodStart));
    setPeriodEnd(shift(periodEnd));
  };

  const grandTotals = rows.reduce(
    (acc, r) => ({
      hours: acc.hours + r.hours,
      calculated: acc.calculated + r.calculatedAmount,
      adjustment: acc.adjustment + r.adjustment,
      total: acc.total + r.totalWithAdjustment,
      gross: acc.gross + r.grossAmount,
      cash: acc.cash + r.cashAmount,
      tax: acc.tax + r.taxAmount,
      super: acc.super + r.superAmount,
      bank: acc.bank + r.bankDepositAmount,
      directWages: acc.directWages + (!r.isIntercompany ? r.totalWithAdjustment : 0),
      intercompanyTransfers: acc.intercompanyTransfers + (r.isIntercompany ? r.intercompanyAmount : 0),
    }),
    { hours: 0, calculated: 0, adjustment: 0, total: 0, gross: 0, cash: 0, tax: 0, super: 0, bank: 0, directWages: 0, intercompanyTransfers: 0 }
  );
  const hasIntercompany = rows.some(r => r.isIntercompany);

  const fmtMoney = (v: number) =>
    `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <AdminLayout title="Timesheet & Payroll">
      <div className="space-y-6">
        <div className="sticky top-0 z-30 bg-background pb-2 space-y-2 border-b">
          {!storesLoading && <CashBalances stores={stores || []} />}

          <CashCounter />

          <Card>
            <div
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
              onClick={() => setConvertOpen((v) => !v)}
              data-testid="button-toggle-convert"
            >
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold">Quick Convert / Remittance</span>
              {convertOpen ? (
                <ChevronUp className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              )}
            </div>
            {convertOpen && (
              <CardContent>
                {storesLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <ConvertForm stores={stores || []} />
                )}
              </CardContent>
            )}
          </Card>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 min-w-[140px]">
              <Label className="text-xs">Store</Label>
              <Select
                value={selectedStoreId}
                onValueChange={handleStoreChange}
              >
                <SelectTrigger className="h-8 text-sm" data-testid="select-payroll-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {activeInternalStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-0.5">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => shiftPeriod(-1)} data-testid="button-period-prev">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="text-center">
                <Label className="text-xs">Period Start</Label>
                <span className="block text-xs min-w-[80px]" data-testid="text-period-start">{periodStart}</span>
              </div>
              <span className="text-muted-foreground text-xs pb-0.5">~</span>
              <div className="text-center">
                <Label className="text-xs">Period End</Label>
                <span className="block text-xs min-w-[80px]" data-testid="text-period-end">{periodEnd}</span>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => shiftPeriod(1)} data-testid="button-period-next">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => {
                const f = getLastFortnight();
                setPeriodStart(f.start);
                setPeriodEnd(f.end);
              }}
              data-testid="button-this-week"
            >
              This Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => {
                const qs = new URLSearchParams({
                  period_start: periodStart,
                  period_end: periodEnd,
                });
                window.open(`/admin/payslips?${qs}`, "_blank");
              }}
              data-testid="button-print-payslips"
            >
              <Printer className="h-4 w-4 mr-1.5" />
              Print Pay Slips
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => setBankTrackerOpen(true)}
              data-testid="button-bank-transfer-tracker"
            >
              <Landmark className="h-4 w-4 mr-1.5" />
              Bank Transfer
            </Button>
          </div>
        </div>

        {rows.length > 0 && selectedStore && (
          <div className="bg-card border rounded-md px-4 py-3 space-y-2">
            {/* Standard totals row */}
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <span className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Store Totals</span>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Hours:</span>
                <span className="font-mono font-medium" data-testid="text-total-hours">{grandTotals.hours.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-mono font-medium" data-testid="text-total-with-adj">{fmtMoney(grandTotals.total)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Gross:</span>
                <span className="font-mono font-medium" data-testid="text-total-gross">{fmtMoney(grandTotals.gross)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Cash:</span>
                <span className="font-mono font-medium text-amber-700 dark:text-amber-400" data-testid="text-total-cash">{fmtMoney(grandTotals.cash)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Bank:</span>
                <span className="font-mono font-medium" data-testid="text-total-bank">{fmtMoney(grandTotals.bank)}</span>
              </div>
              {cashBalances && selectedStore.name && cashBalances[selectedStore.name] !== undefined && (
                <div className="flex items-center gap-1 border-l pl-4 ml-2">
                  <span className="text-muted-foreground">Cash Balance:</span>
                  <span
                    className={`font-mono font-bold ${cashBalances[selectedStore.name] < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                    data-testid="text-cash-diff"
                  >
                    {fmtMoney(cashBalances[selectedStore.name])}
                  </span>
                </div>
              )}
            </div>
            {/* Intercompany breakdown row — shown only when intercompany employees exist */}
            {hasIntercompany && (
              <div className="flex items-center gap-4 flex-wrap border-t pt-2 text-sm">
                <span className="text-muted-foreground uppercase text-xs tracking-wide flex items-center gap-1">
                  <ArrowRightLeft className="h-3 w-3" />
                  Funds Required
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">Direct Wages:</span>
                  <span className="font-mono font-medium text-xs" data-testid="text-direct-wages">{fmtMoney(grandTotals.directWages)}</span>
                </div>
                <span className="text-muted-foreground text-xs">+</span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">Intercompany Transfers:</span>
                  <span className="font-mono font-medium text-xs text-blue-600 dark:text-blue-400" data-testid="text-intercompany-total">{fmtMoney(grandTotals.intercompanyTransfers)}</span>
                </div>
                <span className="text-muted-foreground text-xs">=</span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs font-semibold">Total Required:</span>
                  <span className="font-mono font-semibold text-sm" data-testid="text-total-required">{fmtMoney(grandTotals.directWages + grandTotals.intercompanyTransfers)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {dataLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p data-testid="text-empty-payroll">
              {selectedStoreId
                ? "해당 매장에 등록된 직원이 없습니다"
                : "매장을 선택하세요"}
            </p>
          </div>
        ) : (
          <>
            {(() => {
              const filtered = rows.map((r, i) => ({ row: r, originalIdx: i })).filter(({ row }) =>
                searchQuery === "" || row.employeeName.toLowerCase().includes(searchQuery.toLowerCase())
              );
              const clampedIdx = Math.min(selectedIdx, rows.length - 1);
              const selectedRow = rows[clampedIdx];

              const handleListKeyDown = (e: React.KeyboardEvent) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const currentFilterPos = filtered.findIndex(f => f.originalIdx === clampedIdx);
                  const nextPos = Math.min(currentFilterPos + 1, filtered.length - 1);
                  if (filtered[nextPos]) setSelectedIdx(filtered[nextPos].originalIdx);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const currentFilterPos = filtered.findIndex(f => f.originalIdx === clampedIdx);
                  const prevPos = Math.max(currentFilterPos - 1, 0);
                  if (filtered[prevPos]) setSelectedIdx(filtered[prevPos].originalIdx);
                }
              };

              return (
                <div className="flex gap-4 min-h-[500px]">
                  <div className="w-[38%] min-w-[280px] flex flex-col">
                    <Card className="flex-1 flex flex-col overflow-hidden">
                      <CardHeader className="pb-2 pt-3 px-3 space-y-2">
                        <CardTitle className="text-sm">Employees ({rows.length})</CardTitle>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search employee..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); }}
                            className="pl-8 text-sm"
                            data-testid="input-search-employee"
                          />
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 overflow-y-auto p-0" ref={listRef}>
                        <div
                          className="divide-y"
                          onKeyDown={handleListKeyDown}
                          tabIndex={0}
                          role="listbox"
                          data-testid="list-employees"
                        >
                          {filtered.map(({ row, originalIdx }) => {
                            const isSelected = originalIdx === clampedIdx;
                            const hasData = row.hours > 0 || row.totalWithAdjustment > 0;
                            return (
                              <div
                                key={row.employeeId}
                                role="option"
                                aria-selected={isSelected}
                                className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                                  isSelected ? "bg-muted" : "hover-elevate"
                                }`}
                                onClick={() => setSelectedIdx(originalIdx)}
                                data-testid={`list-item-employee-${row.employeeId}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                  <span className="text-sm font-medium truncate" data-testid={`text-employee-name-${row.employeeId}`}>
                                    {row.employeeName}
                                  </span>
                                  {row.isCover && (
                                    <span className="text-[10px] italic text-muted-foreground flex-shrink-0" data-testid={`badge-cover-${row.employeeId}`}>
                                      (Cover)
                                    </span>
                                  )}
                                  {row.isIntercompany && (
                                    <ArrowRightLeft className="h-3 w-3 text-blue-500 flex-shrink-0" data-testid={`icon-intercompany-${row.employeeId}`} />
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  {row.isIntercompany ? (
                                    <span className="text-xs font-mono font-medium tabular-nums text-blue-600 dark:text-blue-400" data-testid={`text-intercompany-amount-list-${row.employeeId}`}>
                                      {fmtMoney(row.intercompanyAmount)}
                                    </span>
                                  ) : hasData ? (
                                    <>
                                      <span className="text-xs text-muted-foreground tabular-nums">{row.hours}h</span>
                                      <span className="text-xs font-mono font-medium tabular-nums">{fmtMoney(row.totalWithAdjustment)}</span>
                                    </>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="w-[62%] flex flex-col">
                    {selectedRow ? (
                      <Card className="flex-1" data-testid={`card-detail-${selectedRow.employeeId}`}>
                        <CardHeader className="pb-3 pt-3 px-4">
                          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                            <User className="h-4 w-4" />
                            {selectedRow.employeeName}
                            {selectedRow.isIntercompany
                              ? <Badge className="bg-blue-500 text-white text-xs">Intercompany Transfer</Badge>
                              : selectedRow.fixedAmount > 0 && <Badge variant="secondary" className="text-xs">Fixed</Badge>
                            }
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 space-y-5">
                          {/* Intercompany banner — shown when this employee's salary is paid by another store */}
                          {selectedRow.isIntercompany && (
                            <div className="rounded-md border border-blue-400/40 bg-blue-400/8 px-4 py-3 space-y-2" data-testid={`banner-intercompany-${selectedRow.employeeId}`}>
                              <div className="flex items-center gap-2">
                                <ArrowRightLeft className="h-4 w-4 text-blue-500 shrink-0" />
                                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Intercompany Cost Allocation</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                이 직원의 고정급은 다른 매장에서 지급됩니다. 아래 금액은 이 매장의 근무 비율에 따라 산출된 정산 금액이며, 페이롤 저장 시 자동으로 인터컴퍼니 정산 내역에 기록됩니다.
                              </p>
                              <div className="grid grid-cols-3 gap-3 pt-1">
                                <div className="space-y-0.5">
                                  <p className="text-xs text-muted-foreground">This Store Hours</p>
                                  <p className="text-sm font-mono font-medium" data-testid={`text-ic-current-hours-${selectedRow.employeeId}`}>{selectedRow.hours.toFixed(1)}h</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-xs text-muted-foreground">All Stores Total</p>
                                  <p className="text-sm font-mono font-medium" data-testid={`text-ic-total-hours-${selectedRow.employeeId}`}>{selectedRow.totalAllStoreHours.toFixed(1)}h</p>
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-xs text-muted-foreground">Ratio</p>
                                  <p className="text-sm font-mono font-medium">
                                    {selectedRow.totalAllStoreHours > 0
                                      ? `${Math.round((selectedRow.hours / selectedRow.totalAllStoreHours) * 100)}%`
                                      : "—"}
                                  </p>
                                </div>
                              </div>
                              <div className="pt-1 border-t border-blue-400/20">
                                <p className="text-xs text-muted-foreground">Apportioned Amount Owed</p>
                                <p className="text-xl font-mono font-bold text-blue-700 dark:text-blue-400" data-testid={`text-intercompany-amount-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.intercompanyAmount)}
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">직접 지급액: $0.00 (이 매장은 해당 직원에게 직접 지급하지 않습니다)</p>
                              </div>
                            </div>
                          )}
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Basis</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Rate</Label>
                                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2" data-testid={`text-rate-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.rate)}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Fixed Amount</Label>
                                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2" data-testid={`text-fixed-${selectedRow.employeeId}`}>
                                  {selectedRow.fixedAmount > 0 ? fmtMoney(selectedRow.fixedAmount) : "—"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inputs</p>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Hours</Label>
                                <Input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="text-sm"
                                  value={selectedRow.hours || ""}
                                  onChange={(e) => updateRow(clampedIdx, "hours", parseFloat(e.target.value) || 0)}
                                  disabled={selectedRow.isIntercompany}
                                  data-testid={`input-hours-${selectedRow.employeeId}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Adjustment</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="text-sm"
                                  value={selectedRow.adjustment || ""}
                                  onChange={(e) => updateRow(clampedIdx, "adjustment", parseFloat(e.target.value) || 0)}
                                  disabled={selectedRow.isIntercompany}
                                  data-testid={`input-adjustment-${selectedRow.employeeId}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Adj Reason</Label>
                                <Input
                                  className="text-sm"
                                  placeholder="Reason"
                                  value={selectedRow.adjustmentReason}
                                  onChange={(e) => updateRow(clampedIdx, "adjustmentReason", e.target.value)}
                                  disabled={selectedRow.isIntercompany}
                                  data-testid={`input-adj-reason-${selectedRow.employeeId}`}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment Split</p>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Gross</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="text-sm"
                                  value={selectedRow.grossAmount || ""}
                                  onChange={(e) => updateRow(clampedIdx, "grossAmount", parseFloat(e.target.value) || 0)}
                                  disabled={selectedRow.isIntercompany}
                                  data-testid={`input-gross-${selectedRow.employeeId}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Cash</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="text-sm"
                                  value={selectedRow.cashAmount || ""}
                                  onChange={(e) => updateRow(clampedIdx, "cashAmount", parseFloat(e.target.value) || 0)}
                                  disabled={selectedRow.isIntercompany}
                                  data-testid={`input-cash-${selectedRow.employeeId}`}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs flex items-center gap-1">
                                  Tax (PAYG)
                                  {selectedRow.taxOverridden && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 no-default-active-elevate">Manual</Badge>
                                  )}
                                </Label>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    step="1"
                                    min="0"
                                    className={`text-sm ${selectedRow.taxOverridden ? "border-orange-400 dark:border-orange-600" : ""}`}
                                    value={selectedRow.taxAmount || ""}
                                    onChange={(e) => updateRow(clampedIdx, "taxAmount", parseFloat(e.target.value) || 0)}
                                    disabled={selectedRow.isIntercompany}
                                    data-testid={`input-tax-${selectedRow.employeeId}`}
                                  />
                                  {selectedRow.taxOverridden && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setRows(prev => {
                                          const updated = [...prev];
                                          const row = { ...updated[clampedIdx], taxOverridden: false };
                                          updated[clampedIdx] = recalcRow(row);
                                          return updated;
                                        });
                                      }}
                                      data-testid={`button-reset-tax-${selectedRow.employeeId}`}
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Results</p>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <div className="space-y-1">
                                <Label className="text-xs">Calculated</Label>
                                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2" data-testid={`text-calculated-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.calculatedAmount)}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Total w/ Adj</Label>
                                <div className={`font-mono text-sm font-medium rounded-md px-3 py-2 ${
                                  selectedRow.totalWithAdjustment < 0
                                    ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                                    : "bg-muted/50"
                                }`} data-testid={`text-total-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.totalWithAdjustment)}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Super (11.5%)</Label>
                                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2" data-testid={`text-super-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.superAmount)}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Bank Deposit</Label>
                                <div className="font-mono text-sm bg-muted/50 rounded-md px-3 py-2 font-medium" data-testid={`text-bank-${selectedRow.employeeId}`}>
                                  {fmtMoney(selectedRow.bankDepositAmount)}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Memo</p>
                            <Textarea
                              className="text-sm resize-none"
                              placeholder="Employee memo (삭제할 때까지 유지됩니다)"
                              value={selectedRow.persistentMemo}
                              onChange={(e) => updateRow(clampedIdx, "persistentMemo", e.target.value)}
                              rows={2}
                              data-testid={`textarea-memo-${selectedRow.employeeId}`}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="flex-1 flex items-center justify-center">
                        <p className="text-muted-foreground text-sm">직원을 선택하세요</p>
                      </Card>
                    )}
                  </div>
                </div>
              );
            })()}

            {selectedStore && (
              <div className="space-y-2">
                <Label className="text-sm">
                  Global Payroll Note ({selectedStore.name})
                </Label>
                <Textarea
                  value={globalNote}
                  onChange={(e) => setGlobalNote(e.target.value)}
                  placeholder="이 매장의 급여 관련 메모를 입력하세요 (삭제할 때까지 유지됩니다)"
                  className="text-sm"
                  data-testid="textarea-global-note"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || rows.length === 0}
                data-testid="button-save-payroll"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save All Payroll"}
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={bankTrackerOpen} onOpenChange={setBankTrackerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-4 w-4" />
              Bank Transfer Tracker
              <span className="text-sm font-normal text-muted-foreground ml-1">
                {periodStart} ~ {periodEnd}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {bankDepositsLoading ? (
              <div className="space-y-2 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !bankDeposits || bankDeposits.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Landmark className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>이 기간에 은행 이체 대상 직원이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-0 border rounded-md overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_110px_64px] gap-0 bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">
                  <span>Store</span>
                  <span>Employee</span>
                  <span className="text-right">Bank Deposit</span>
                  <span className="text-center">Done</span>
                </div>
                {bankDeposits.map((entry) => {
                  const isPending = bankTransferMutation.isPending;
                  return (
                    <div
                      key={entry.payrollId}
                      className={`grid grid-cols-[1fr_1fr_110px_64px] gap-0 px-4 py-2.5 text-sm border-b last:border-b-0 items-center transition-colors ${
                        entry.isBankTransferDone ? "bg-muted/30" : ""
                      }`}
                      data-testid={`row-bank-transfer-${entry.payrollId}`}
                    >
                      <span className={`font-medium truncate ${entry.isBankTransferDone ? "text-muted-foreground line-through" : ""}`} data-testid={`text-bank-store-${entry.payrollId}`}>
                        {entry.storeName}
                      </span>
                      <div className="min-w-0">
                        <span className={`truncate block ${entry.isBankTransferDone ? "text-muted-foreground line-through" : ""}`} data-testid={`text-bank-employee-${entry.payrollId}`}>
                          {entry.employeeName}
                        </span>
                        {entry.bsb && entry.accountNo && (
                          <span className="text-xs text-muted-foreground block truncate">
                            {entry.bsb} / {entry.accountNo}
                          </span>
                        )}
                      </div>
                      <span className={`font-mono text-right font-medium ${entry.isBankTransferDone ? "text-muted-foreground line-through" : ""}`} data-testid={`text-bank-amount-${entry.payrollId}`}>
                        {`$${entry.bankDepositAmount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                      <div className="flex flex-col items-center gap-0.5">
                        <Checkbox
                          checked={entry.isBankTransferDone}
                          disabled={isPending}
                          onCheckedChange={(checked) => {
                            bankTransferMutation.mutate({
                              payrollId: entry.payrollId,
                              isBankTransferDone: !!checked,
                            });
                          }}
                          data-testid={`checkbox-bank-done-${entry.payrollId}`}
                        />
                        {entry.isBankTransferDone && entry.bankTransferDate && (
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{entry.bankTransferDate}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_1fr_110px_64px] gap-0 px-4 py-2.5 bg-muted/50 items-center border-t">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground col-span-2">Total</span>
                  <span className="font-mono text-right font-semibold text-sm" data-testid="text-bank-total">
                    {`$${(bankDeposits || []).reduce((s, e) => s + e.bankDepositAmount, 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                  <div className="flex items-center justify-center">
                    {(bankDeposits || []).every((e) => e.isBankTransferDone) ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
