import { useState, useCallback, useRef, useEffect } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Save, Upload, FileSpreadsheet } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CashBalances } from "@/components/CashBalances";
import { ConvertForm } from "@/components/ConvertForm";
import type { Store, Employee, Payroll } from "@shared/schema";

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
  const g = fortnightlyGross;
  if (g <= 0) return 0;

  const brackets: [number, number, number, number][] = [
    [546, 0, 0, 0],
    [700, 0.19, 0.19, 103.8462],
    [1282, 0.2348, 0.2348, 103.8462],
    [1730, 0.219, 0.219, 83.5769],
    [3461, 0.3477, 0.3477, 306.2692],
    [6924, 0.345, 0.345, 306.2692],
    [Infinity, 0.47, 0.47, -398.1154],
  ];

  for (const [upper, a, b, c] of brackets) {
    if (g < upper) {
      const weekly = Math.max(0, a * (g / 2) - c / 2);
      return Math.round(weekly * 2 * 100) / 100;
    }
  }

  const weekly = Math.max(0, 0.47 * (g / 2) + 398.1154 / 2);
  return Math.round(weekly * 2 * 100) / 100;
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
}

function recalcRow(row: PayrollRow, changedField?: string): PayrollRow {
  const r = { ...row };
  r.calculatedAmount = r.fixedAmount > 0 ? r.fixedAmount : r.hours * r.rate;
  r.totalWithAdjustment = r.calculatedAmount + r.adjustment;

  if (changedField === "grossAmount") {
    r.cashAmount = Math.max(0, r.totalWithAdjustment - r.grossAmount);
    r.lastEditedField = "gross";
  } else if (changedField === "cashAmount") {
    r.grossAmount = Math.max(0, r.totalWithAdjustment - r.cashAmount);
    r.lastEditedField = "cash";
  } else if (r.lastEditedField === "gross") {
    r.cashAmount = Math.max(0, r.totalWithAdjustment - r.grossAmount);
  } else if (r.lastEditedField === "cash") {
    r.grossAmount = Math.max(0, r.totalWithAdjustment - r.cashAmount);
  } else {
    if (r.grossAmount === 0 && r.cashAmount === 0) {
      r.grossAmount = r.totalWithAdjustment;
    }
  }

  r.superAmount = Math.round(r.grossAmount * SUPER_RATE * 100) / 100;

  if (changedField !== "taxAmount") {
    r.taxAmount = calculatePaygTax(r.grossAmount);
  }

  r.bankDepositAmount = Math.max(0, r.grossAmount - r.taxAmount);

  return r;
}

function formatPeriodLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  return `${fmt(s)} - ${fmt(e)}`;
}

export function AdminPayrolls() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const fortnight = getLastFortnight();
  const [periodStart, setPeriodStart] = useState(fortnight.start);
  const [periodEnd, setPeriodEnd] = useState(fortnight.end);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [globalNote, setGlobalNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const activeInternalStores = (stores || []).filter(
    (s) => s.active && !s.isExternal
  );

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

  useEffect(() => {
    if (!currentData) return;
    const newRows: PayrollRow[] = currentData.map(({ employee, payroll }) => {
      const empRate = parseFloat(employee.rate || "0");
      const empFixed = parseFloat(employee.fixedAmount || "0");
      if (payroll) {
        return {
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          payrollId: payroll.id,
          hours: payroll.hours,
          rate: payroll.rate || empRate,
          fixedAmount: payroll.fixedAmount || empFixed,
          calculatedAmount: payroll.calculatedAmount,
          adjustment: payroll.adjustment,
          adjustmentReason: payroll.adjustmentReason || "",
          totalWithAdjustment: payroll.totalWithAdjustment,
          grossAmount: payroll.grossAmount,
          cashAmount: payroll.cashAmount,
          taxAmount: payroll.taxAmount,
          superAmount: payroll.superAmount,
          bankDepositAmount: payroll.bankDepositAmount,
          persistentMemo: employee.persistentMemo || "",
          lastEditedField: null,
        };
      }
      const base: PayrollRow = {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        payrollId: null,
        hours: 0,
        rate: empRate,
        fixedAmount: empFixed,
        calculatedAmount: 0,
        adjustment: 0,
        adjustmentReason: "",
        totalWithAdjustment: 0,
        grossAmount: 0,
        cashAmount: 0,
        taxAmount: 0,
        superAmount: 0,
        bankDepositAmount: 0,
        persistentMemo: employee.persistentMemo || "",
        lastEditedField: null,
      };
      return recalcRow(base);
    });
    setRows(newRows);
  }, [currentData]);

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
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/employees/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Import failed");
      return res.json();
    },
    onSuccess: (data: { imported: number; skipped: number; errors: string[] }) => {
      toast({
        title: `Imported ${data.imported} employee(s)`,
        description:
          data.skipped > 0 ? `${data.skipped} skipped` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/payrolls/current"],
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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
    }),
    { hours: 0, calculated: 0, adjustment: 0, total: 0, gross: 0, cash: 0, tax: 0, super: 0, bank: 0 }
  );

  const fmtMoney = (v: number) =>
    `$${v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <AdminLayout title="Timesheet & Payroll">
      <div className="space-y-6">
        <div className="sticky top-0 z-30 bg-background pb-4 space-y-4 border-b">
          {!storesLoading && <CashBalances stores={stores || []} />}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <DollarSign className="h-4 w-4" />
                Quick Convert
              </CardTitle>
            </CardHeader>
            <CardContent>
              {storesLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ConvertForm stores={stores || []} />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 min-w-[200px]">
              <Label>Store</Label>
              <Select
                value={selectedStoreId}
                onValueChange={handleStoreChange}
              >
                <SelectTrigger data-testid="select-payroll-store">
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
            <div className="space-y-2">
              <Label>Period Start</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                data-testid="input-period-start"
              />
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                data-testid="input-period-end"
              />
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importMutation.mutate(file);
                  e.target.value = "";
                }}
                data-testid="input-import-file"
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importMutation.isPending}
                data-testid="button-import-employees"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Employees
              </Button>
            </div>
            {periodStart && periodEnd && (
              <p className="text-sm text-muted-foreground self-center" data-testid="text-period-label">
                {formatPeriodLabel(periodStart, periodEnd)}
              </p>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payroll Grid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <div className="overflow-x-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="whitespace-nowrap min-w-[140px] sticky left-0 bg-muted/50 z-10">
                          Employee
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[80px]">
                          Hours
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[80px]">
                          Rate
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[80px]">
                          Fixed
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Calculated
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Adjustment
                        </TableHead>
                        <TableHead className="whitespace-nowrap min-w-[120px]">
                          Adj Reason
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Total w/ Adj
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Gross
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Cash
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Tax (PAYG)
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Super
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap min-w-[90px]">
                          Bank Dep.
                        </TableHead>
                        <TableHead className="whitespace-nowrap min-w-[160px]">
                          Memo
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow
                          key={row.employeeId}
                          data-testid={`row-payroll-${row.employeeId}`}
                        >
                          <TableCell className="font-medium whitespace-nowrap sticky left-0 bg-background z-10" data-testid={`text-employee-name-${row.employeeId}`}>
                            {row.employeeName}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              className="w-20 text-right text-sm"
                              value={row.hours || ""}
                              onChange={(e) =>
                                updateRow(
                                  idx,
                                  "hours",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              data-testid={`input-hours-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`text-rate-${row.employeeId}`}>
                            {fmtMoney(row.rate)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`text-fixed-${row.employeeId}`}>
                            {row.fixedAmount > 0 ? fmtMoney(row.fixedAmount) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`text-calculated-${row.employeeId}`}>
                            {fmtMoney(row.calculatedAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-20 text-right text-sm"
                              value={row.adjustment || ""}
                              onChange={(e) =>
                                updateRow(
                                  idx,
                                  "adjustment",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              data-testid={`input-adjustment-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="w-28 text-sm"
                              placeholder="Reason"
                              value={row.adjustmentReason}
                              onChange={(e) =>
                                updateRow(idx, "adjustmentReason", e.target.value)
                              }
                              data-testid={`input-adj-reason-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono text-sm font-medium ${
                              row.totalWithAdjustment < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }`}
                            data-testid={`text-total-${row.employeeId}`}
                          >
                            {fmtMoney(row.totalWithAdjustment)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24 text-right text-sm"
                              value={row.grossAmount || ""}
                              onChange={(e) =>
                                updateRow(
                                  idx,
                                  "grossAmount",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              data-testid={`input-gross-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24 text-right text-sm"
                              value={row.cashAmount || ""}
                              onChange={(e) =>
                                updateRow(
                                  idx,
                                  "cashAmount",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              data-testid={`input-cash-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-20 text-right text-sm"
                              value={row.taxAmount || ""}
                              onChange={(e) =>
                                updateRow(
                                  idx,
                                  "taxAmount",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              data-testid={`input-tax-${row.employeeId}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`text-super-${row.employeeId}`}>
                            {fmtMoney(row.superAmount)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm" data-testid={`text-bank-${row.employeeId}`}>
                            {fmtMoney(row.bankDepositAmount)}
                          </TableCell>
                          <TableCell>
                            <Textarea
                              className="min-w-[140px] text-sm min-h-[36px] resize-none"
                              placeholder="Employee memo"
                              value={row.persistentMemo}
                              onChange={(e) =>
                                updateRow(idx, "persistentMemo", e.target.value)
                              }
                              data-testid={`textarea-memo-${row.employeeId}`}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold border-t-2">
                        <TableCell className="sticky left-0 bg-muted/50 z-10">
                          TOTALS
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-hours">
                          {grandTotals.hours.toFixed(1)}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right font-mono" data-testid="text-total-calculated">
                          {fmtMoney(grandTotals.calculated)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-adjustment">
                          {fmtMoney(grandTotals.adjustment)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right font-mono" data-testid="text-total-with-adj">
                          {fmtMoney(grandTotals.total)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-gross">
                          {fmtMoney(grandTotals.gross)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-cash">
                          {fmtMoney(grandTotals.cash)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-tax">
                          {fmtMoney(grandTotals.tax)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-super">
                          {fmtMoney(grandTotals.super)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid="text-total-bank">
                          {fmtMoney(grandTotals.bank)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || rows.length === 0}
                    data-testid="button-save-payroll"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saveMutation.isPending
                      ? "Saving..."
                      : "Save All Payroll"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
