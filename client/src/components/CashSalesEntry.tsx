import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Save, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store, CashSalesDetail } from "@shared/schema";

const ALL_DENOMINATIONS = [
  { key: "note100Count", label: "$100", value: 100 },
  { key: "note50Count", label: "$50", value: 50 },
  { key: "note20Count", label: "$20", value: 20 },
  { key: "note10Count", label: "$10", value: 10 },
  { key: "note5Count", label: "$5", value: 5 },
  { key: "coin2Count", label: "$2", value: 2 },
  { key: "coin1Count", label: "$1", value: 1 },
  { key: "coin050Count", label: "50c", value: 0.5 },
  { key: "coin020Count", label: "20c", value: 0.2 },
  { key: "coin010Count", label: "10c", value: 0.1 },
  { key: "coin005Count", label: "5c", value: 0.05 },
] as const;

const DENOMINATIONS = ALL_DENOMINATIONS.filter(d => d.value >= 5);

type DenomKey = typeof ALL_DENOMINATIONS[number]["key"];

interface RowData {
  date: string;
  envelopeAmount: number;
  countedAmount: number;
  differenceAmount: number;
  memo: string;
  [key: string]: number | string;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  return DAY_NAMES[dow === 0 ? 6 : dow - 1];
}

function calcCounted(row: RowData): number {
  let total = 0;
  for (const denom of ALL_DENOMINATIONS) {
    const count = Number(row[denom.key]) || 0;
    total += count * denom.value;
  }
  return Math.round(total * 100) / 100;
}

function createEmptyRow(date: string): RowData {
  const row: RowData = {
    date,
    envelopeAmount: 0,
    countedAmount: 0,
    differenceAmount: 0,
    memo: "",
  };
  for (const d of ALL_DENOMINATIONS) {
    row[d.key] = 0;
  }
  return row;
}

export function CashSalesEntry({ stores }: { stores: Store[] }) {
  const { toast } = useToast();
  const [storeId, setStoreId] = useState("");
  const [periodStart, setPeriodStart] = useState<Date>(() => {
    const now = new Date();
    const mon = getMonday(now);
    return addDays(mon, -14);
  });
  const [rows, setRows] = useState<RowData[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const cashSalesStoreOrder = ["sushi", "sandwich", "trading"];
  const activeStores = stores
    .filter((s) => s.active && !s.isExternal && s.name.toUpperCase() !== "HO")
    .sort((a, b) => {
      const ai = cashSalesStoreOrder.indexOf(a.name.toLowerCase());
      const bi = cashSalesStoreOrder.indexOf(b.name.toLowerCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const startDate = formatDateStr(periodStart);
  const endDate = formatDateStr(addDays(periodStart, 13));

  const { data: existingData, isLoading: loadingData } = useQuery<CashSalesDetail[]>({
    queryKey: ["/api/cash-sales", storeId, startDate, endDate],
    enabled: !!storeId,
    queryFn: async () => {
      const params = new URLSearchParams({
        store_id: storeId,
        start_date: startDate,
        end_date: endDate,
      });
      const res = await fetch(`/api/cash-sales?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    const newRows: RowData[] = [];
    for (let i = 0; i < 14; i++) {
      const date = formatDateStr(addDays(periodStart, i));
      const existing = existingData?.find((d) => d.date === date);
      if (existing) {
        const row: RowData = {
          date: existing.date,
          envelopeAmount: existing.envelopeAmount,
          countedAmount: existing.countedAmount,
          differenceAmount: existing.differenceAmount,
          memo: (existing as any).memo ?? "",
        };
        for (const denom of ALL_DENOMINATIONS) {
          row[denom.key] = (existing as any)[denom.key] ?? 0;
        }
        newRows.push(row);
      } else {
        newRows.push(createEmptyRow(date));
      }
    }
    setRows(newRows);
    setIsDirty(false);
  }, [existingData, periodStart]);

  const updateRow = useCallback(
    (index: number, field: string, value: number) => {
      setRows((prev) => {
        const next = [...prev];
        const row = { ...next[index] };
        row[field] = value;

        if (field !== "envelopeAmount") {
          row.countedAmount = calcCounted(row);
        }
        row.differenceAmount = Math.round(((row.envelopeAmount as number) - (row.countedAmount as number)) * 100) / 100;
        next[index] = row;
        return next;
      });
      setIsDirty(true);
    },
    []
  );

  const grandTotal = useMemo(() => {
    return Math.round(rows.reduce((sum, r) => sum + (r.countedAmount as number), 0) * 100) / 100;
  }, [rows]);

  const totalEnvelope = useMemo(() => {
    return Math.round(rows.reduce((sum, r) => sum + (r.envelopeAmount as number), 0) * 100) / 100;
  }, [rows]);

  const totalDifference = useMemo(() => {
    return Math.round((totalEnvelope - grandTotal) * 100) / 100;
  }, [totalEnvelope, grandTotal]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cash-sales/bulk", {
        storeId,
        startDate,
        endDate,
        rows: rows.map((r) => ({
          date: r.date,
          envelopeAmount: r.envelopeAmount,
          countedAmount: r.countedAmount,
          note100Count: r.note100Count ?? 0,
          note50Count: r.note50Count ?? 0,
          note20Count: r.note20Count ?? 0,
          note10Count: r.note10Count ?? 0,
          note5Count: r.note5Count ?? 0,
          coin2Count: r.coin2Count ?? 0,
          coin1Count: r.coin1Count ?? 0,
          coin050Count: r.coin050Count ?? 0,
          coin020Count: r.coin020Count ?? 0,
          coin010Count: r.coin010Count ?? 0,
          coin005Count: r.coin005Count ?? 0,
          differenceAmount: r.differenceAmount,
          memo: r.memo || null,
        })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Cash sales saved", description: `${data.saved}일 저장 완료. 총 $${data.totalCounted.toLocaleString()}` });
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cash-sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const shiftPeriod = (direction: number) => {
    setPeriodStart((prev) => addDays(prev, direction * 14));
    setDateEditValues({});
    setExpandedMemoIdx(null);
  };

  const formatShortDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  };

  const TAB_COLS = ["dateInput", "envelopeAmount", ...DENOMINATIONS.map((d) => d.key)];

  const [dateEditValues, setDateEditValues] = useState<Record<number, string>>({});
  const [expandedMemoIdx, setExpandedMemoIdx] = useState<number | null>(null);

  useEffect(() => {
    setExpandedMemoIdx(null);
  }, [storeId]);

  const resolveDateInput = useCallback((input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const slashMatch = trimmed.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10);
      for (let i = 0; i < 14; i++) {
        const d = addDays(periodStart, i);
        if (d.getDate() === day && d.getMonth() + 1 === month) {
          return formatDateStr(d);
        }
      }
      return null;
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1 || num > 31) return null;
    for (let i = 0; i < 14; i++) {
      const d = addDays(periodStart, i);
      if (d.getDate() === num) {
        return formatDateStr(d);
      }
    }
    return null;
  }, [periodStart]);

  const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const formatDateDisplay = (dateStr: string) => {
    const parts = dateStr.split("-");
    const day = parseInt(parts[2], 10);
    const month = parseInt(parts[1], 10);
    return `${day}/${MONTH_SHORT[month]}`;
  };

  const applyDateChange = useCallback((rowIdx: number, moveFocus: boolean) => {
    const val = dateEditValues[rowIdx];
    if (val === undefined || !val.trim()) {
      setDateEditValues((prev) => {
        const next = { ...prev };
        delete next[rowIdx];
        return next;
      });
      if (moveFocus) {
        setTimeout(() => {
          const input = gridRef.current?.querySelector(
            `[data-row="${rowIdx}"][data-col="envelopeAmount"]`
          ) as HTMLInputElement | null;
          if (input) { input.focus(); input.select(); }
        }, 50);
      }
      return;
    }
    const resolved = resolveDateInput(val);
    setDateEditValues((prev) => {
      const next = { ...prev };
      delete next[rowIdx];
      return next;
    });
    if (resolved) {
      setRows((prev) => {
        const next = [...prev];
        next[rowIdx] = { ...next[rowIdx], date: resolved };
        return next;
      });
      setIsDirty(true);
      if (moveFocus) {
        setTimeout(() => {
          const input = gridRef.current?.querySelector(
            `[data-row="${rowIdx}"][data-col="envelopeAmount"]`
          ) as HTMLInputElement | null;
          if (input) { input.focus(); input.select(); }
        }, 50);
      }
    }
  }, [dateEditValues, resolveDateInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colKey: string) => {
      const colIdx = TAB_COLS.indexOf(colKey);
      if (colIdx === -1) return;

      if (colKey === "dateInput" && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        applyDateChange(rowIdx, true);
        return;
      }

      let nextRow = rowIdx;
      let nextCol = colIdx;

      if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        nextRow = Math.min(rowIdx + 1, 13);
      } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        nextRow = Math.max(rowIdx - 1, 0);
      } else if (e.key === "Tab" && !e.shiftKey) {
        if (colIdx < TAB_COLS.length - 1) {
          e.preventDefault();
          nextCol = colIdx + 1;
        } else {
          e.preventDefault();
          nextRow = Math.min(rowIdx + 1, 13);
          nextCol = 0;
        }
      } else if (e.key === "Tab" && e.shiftKey) {
        if (colIdx > 0) {
          e.preventDefault();
          nextCol = colIdx - 1;
        } else if (rowIdx > 0) {
          e.preventDefault();
          nextRow = rowIdx - 1;
          nextCol = TAB_COLS.length - 1;
        }
      } else {
        return;
      }

      const nextInput = gridRef.current?.querySelector(
        `[data-row="${nextRow}"][data-col="${TAB_COLS[nextCol]}"]`
      ) as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    },
    [applyDateChange]
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        2주간 매장별 현금 매출 실물 정산 입력
      </p>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1.5 min-w-[180px]">
          <Label>Store</Label>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger data-testid="select-cashsales-store">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {activeStores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Period</Label>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              onClick={() => shiftPeriod(-1)}
              data-testid="button-period-prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium px-3 min-w-[180px] text-center whitespace-nowrap" data-testid="text-period-range">
              {startDate} ~ {endDate}
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => shiftPeriod(1)}
              data-testid="button-period-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!storeId || saveMutation.isPending || !isDirty}
          className="gap-1"
          data-testid="button-save-cashsales"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      {!storeId ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          매장을 선택해 주세요
        </p>
      ) : loadingData ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : (
        <div ref={gridRef} className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col className="w-[82px]" />
              <col className="w-[70px]" />
              <col className="w-[70px]" />
              {DENOMINATIONS.map((d) => (
                <col key={d.key} className="w-[44px]" />
              ))}
              <col className="w-[62px]" />
              <col />
            </colgroup>
            <thead>
              <tr className="bg-muted/50">
                <th className="sticky left-0 bg-muted/50 z-10 px-1 py-1 text-left font-medium border-b border-r">Date</th>
                <th className="px-1 py-1 text-right font-medium border-b border-r">Envelope</th>
                <th className="px-1 py-1 text-right font-medium border-b border-r bg-muted/80">Counted</th>
                {DENOMINATIONS.map((d) => (
                  <th key={d.key} className="px-0.5 py-1 text-center font-medium border-b border-r">
                    {d.label}
                  </th>
                ))}
                <th className="px-1 py-1 text-right font-medium border-b border-r">Diff</th>
                <th className="px-1 py-1 text-left font-medium border-b">Memo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const dayLabel = getDayLabel(row.date);
                const isSunday = dayLabel === "Sun";
                const isWeekEnd = idx === 6 || idx === 13;
                const diff = row.differenceAmount as number;
                const hasDiff = Math.abs(diff) >= 0.01;

                return (
                  <tr
                    key={idx}
                    className={`
                      ${isSunday ? "bg-red-50/40 dark:bg-red-950/20" : ""}
                      ${isWeekEnd ? "border-b-2 border-b-border" : ""}
                    `}
                    data-testid={`row-cashsales-${idx}`}
                  >
                    <td className="sticky left-0 bg-background z-10 px-0.5 py-0.5 border-b border-r">
                      <Input
                        type="text"
                        inputMode="numeric"
                        className="h-6 text-xs px-1 tabular-nums font-mono text-center"
                        placeholder=""
                        value={dateEditValues[idx] !== undefined ? dateEditValues[idx] : ""}
                        onChange={(e) => {
                          setDateEditValues((prev) => ({ ...prev, [idx]: e.target.value }));
                        }}
                        onFocus={(e) => {
                          setDateEditValues((prev) => ({ ...prev, [idx]: "" }));
                          e.target.select();
                        }}
                        onBlur={() => applyDateChange(idx, false)}
                        onKeyDown={(e) => handleKeyDown(e, idx, "dateInput")}
                        data-row={idx}
                        data-col="dateInput"
                        data-testid={`input-date-${idx}`}
                      />
                    </td>
                    <td className="px-0.5 py-0.5 border-b border-r">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className={`h-6 text-right text-xs px-1 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                          (row.envelopeAmount as number) > 0 && Math.abs(diff) < 0.01
                            ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                            : ""
                        }`}
                        value={row.envelopeAmount || ""}
                        onChange={(e) => updateRow(idx, "envelopeAmount", parseFloat(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => handleKeyDown(e, idx, "envelopeAmount")}
                        data-row={idx}
                        data-col="envelopeAmount"
                        data-testid={`input-envelope-${idx}`}
                      />
                    </td>
                    <td className="px-1 py-0.5 border-b border-r text-right font-mono text-xs tabular-nums bg-muted/30 font-medium" data-testid={`text-counted-${idx}`}>
                      {(row.countedAmount as number) > 0 ? `$${(row.countedAmount as number).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    {DENOMINATIONS.map((denom) => (
                      <td key={denom.key} className="px-0.5 py-0.5 border-b border-r">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          className="h-6 text-center text-xs px-0 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          value={(row[denom.key] as number) || ""}
                          onChange={(e) => updateRow(idx, denom.key, parseInt(e.target.value) || 0)}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => handleKeyDown(e, idx, denom.key)}
                          data-row={idx}
                          data-col={denom.key}
                          data-testid={`input-${denom.key}-${idx}`}
                        />
                      </td>
                    ))}
                    <td
                      className={`px-1 py-0.5 border-b border-r text-right font-mono text-xs tabular-nums ${hasDiff ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}
                      data-testid={`text-diff-${idx}`}
                    >
                      {hasDiff ? `$${diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td className="px-0.5 py-0.5 border-b relative">
                      {expandedMemoIdx === idx ? (
                        <div className="absolute top-0 left-0 right-0 z-20" style={{ minWidth: "100%" }}>
                          <Textarea
                            className="text-xs px-1 py-1 min-h-[60px] resize-none shadow-lg border bg-background"
                            value={row.memo || ""}
                            autoFocus
                            onChange={(e) => {
                              setRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], memo: e.target.value };
                                return next;
                              });
                              setIsDirty(true);
                            }}
                            onBlur={() => setExpandedMemoIdx(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setExpandedMemoIdx(null);
                              }
                            }}
                            data-testid={`textarea-memo-${idx}`}
                          />
                        </div>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="h-6 text-xs px-1 flex items-center cursor-text truncate rounded-md border border-input bg-background"
                              onClick={() => setExpandedMemoIdx(idx)}
                              onFocus={() => setExpandedMemoIdx(idx)}
                              tabIndex={0}
                              data-testid={`input-memo-${idx}`}
                            >
                              <span className="truncate text-muted-foreground">{row.memo || ""}</span>
                            </div>
                          </TooltipTrigger>
                          {row.memo ? (
                            <TooltipContent side="top" className="max-w-[300px] whitespace-pre-wrap text-xs">
                              {row.memo}
                            </TooltipContent>
                          ) : null}
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/60 font-medium">
                <td className="sticky left-0 bg-muted/60 z-10 px-1 py-1.5 border-t-2 text-xs font-bold">TOTAL</td>
                <td className="px-1 py-1.5 border-t-2 text-right font-mono text-xs tabular-nums" data-testid="text-total-envelope">
                  ${totalEnvelope.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="px-1 py-1.5 border-t-2 text-right font-mono text-xs tabular-nums font-bold bg-muted/80" data-testid="text-grand-total">
                  ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                {DENOMINATIONS.map((d) => {
                  const colTotal = rows.reduce((sum, r) => sum + (Number(r[d.key]) || 0), 0);
                  return (
                    <td key={d.key} className="px-0.5 py-1.5 border-t-2 text-center font-mono text-xs tabular-nums font-bold" data-testid={`text-total-${d.key}`}>
                      {colTotal > 0 ? colTotal : ""}
                    </td>
                  );
                })}
                <td
                  className={`px-1 py-1.5 border-t-2 text-right font-mono text-xs tabular-nums ${Math.abs(totalDifference) >= 0.01 ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}
                  data-testid="text-total-diff"
                >
                  {Math.abs(totalDifference) >= 0.01
                    ? `$${totalDifference.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : "—"}
                </td>
                <td className="px-1 py-1.5 border-t-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
