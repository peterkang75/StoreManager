import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, History, Eye } from "lucide-react";
import { CashSalesEntry } from "@/components/CashSalesEntry";
import type { Store, CashSalesDetail, FinancialTransaction } from "@shared/schema";

const DENOMINATIONS = [
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  return DAY_NAMES[dow === 0 ? 6 : dow - 1];
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function generatePastPeriods(count: number): { start: string; end: string; label: string }[] {
  const now = new Date();
  const currentMonday = getMonday(now);
  const periods: { start: string; end: string; label: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const periodStart = addDays(currentMonday, -(i * 14));
    const periodEnd = addDays(periodStart, 13);
    const startStr = formatDateStr(periodStart);
    const endStr = formatDateStr(periodEnd);
    periods.push({
      start: startStr,
      end: endStr,
      label: `${startStr} ~ ${endStr}`,
    });
  }
  return periods;
}

function CashSalesDetailModal({
  open,
  onOpenChange,
  details,
  storeName,
  periodLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: CashSalesDetail[];
  storeName: string;
  periodLabel: string;
}) {
  const sortedDetails = useMemo(
    () => [...details].sort((a, b) => a.date.localeCompare(b.date)),
    [details]
  );

  const grandTotal = useMemo(
    () => Math.round(sortedDetails.reduce((s, d) => s + d.countedAmount, 0) * 100) / 100,
    [sortedDetails]
  );
  const totalEnvelope = useMemo(
    () => Math.round(sortedDetails.reduce((s, d) => s + d.envelopeAmount, 0) * 100) / 100,
    [sortedDetails]
  );
  const totalDiff = Math.round((totalEnvelope - grandTotal) * 100) / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid="text-modal-title">
            <Banknote className="h-4 w-4" />
            Cash Sales Detail — {storeName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground" data-testid="text-modal-period">{periodLabel}</p>
        </DialogHeader>
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-2 py-1.5 text-left font-medium border-b border-r min-w-[85px]">Date</th>
                <th className="px-2 py-1.5 text-right font-medium border-b border-r min-w-[80px]">Envelope</th>
                {DENOMINATIONS.map((d) => (
                  <th key={d.key} className="px-1 py-1.5 text-center font-medium border-b border-r min-w-[46px] text-xs">
                    {d.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-medium border-b border-r min-w-[80px] bg-muted/80">Counted</th>
                <th className="px-2 py-1.5 text-right font-medium border-b min-w-[70px]">Diff</th>
              </tr>
            </thead>
            <tbody>
              {sortedDetails.map((row) => {
                const dayLabel = getDayLabel(row.date);
                const diff = Math.round((row.envelopeAmount - row.countedAmount) * 100) / 100;
                const hasDiff = Math.abs(diff) >= 0.01;
                const shortDate = `${parseInt(row.date.split("-")[1])}/${parseInt(row.date.split("-")[2])}`;
                return (
                  <tr key={row.date} data-testid={`row-modal-${row.date}`}>
                    <td className="px-2 py-1 border-b border-r font-mono text-xs whitespace-nowrap">
                      <span className="text-muted-foreground mr-1">{dayLabel}</span>{shortDate}
                    </td>
                    <td className="px-2 py-1 border-b border-r text-right font-mono text-xs tabular-nums">
                      {row.envelopeAmount > 0 ? `$${row.envelopeAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    {DENOMINATIONS.map((denom) => {
                      const val = (row as any)[denom.key] || 0;
                      return (
                        <td key={denom.key} className="px-1 py-1 border-b border-r text-center font-mono text-xs tabular-nums text-muted-foreground">
                          {val > 0 ? val : ""}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 border-b border-r text-right font-mono text-xs tabular-nums bg-muted/30 font-medium">
                      {row.countedAmount > 0 ? `$${row.countedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td className={`px-2 py-1 border-b text-right font-mono text-xs tabular-nums ${hasDiff ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}>
                      {hasDiff ? `$${diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/60 font-medium">
                <td className="px-2 py-2 border-t-2 text-xs font-bold">TOTAL</td>
                <td className="px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums">
                  ${totalEnvelope.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                {DENOMINATIONS.map((d) => {
                  const colTotal = sortedDetails.reduce((s, r) => s + ((r as any)[d.key] || 0), 0);
                  return (
                    <td key={d.key} className="px-1 py-2 border-t-2 text-center font-mono text-xs tabular-nums text-muted-foreground">
                      {colTotal > 0 ? colTotal : ""}
                    </td>
                  );
                })}
                <td className="px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums font-bold bg-muted/80">
                  ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className={`px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums ${Math.abs(totalDiff) >= 0.01 ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}>
                  {Math.abs(totalDiff) >= 0.01 ? `$${totalDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryView({ stores }: { stores: Store[] }) {
  const [historyStoreId, setHistoryStoreId] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const activeStores = stores.filter((s) => s.active && !s.isExternal);
  const pastPeriods = useMemo(() => generatePastPeriods(26), []);

  const period = pastPeriods.find((p) => p.label === selectedPeriod);
  const startDate = period?.start || "";
  const endDate = period?.end || "";

  const { data: historyDetails, isLoading: historyLoading } = useQuery<CashSalesDetail[]>({
    queryKey: ["/api/cash-sales", historyStoreId, startDate, endDate],
    enabled: !!historyStoreId && !!startDate && !!endDate,
    queryFn: async () => {
      const params = new URLSearchParams({
        store_id: historyStoreId,
        start_date: startDate,
        end_date: endDate,
      });
      const res = await fetch(`/api/cash-sales?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const storeName = activeStores.find((s) => s.id === historyStoreId)?.name || "";
  const hasData = (historyDetails?.length ?? 0) > 0;

  const summary = useMemo(() => {
    if (!historyDetails || historyDetails.length === 0) return null;
    const totalCounted = Math.round(historyDetails.reduce((s, d) => s + d.countedAmount, 0) * 100) / 100;
    const totalEnvelope = Math.round(historyDetails.reduce((s, d) => s + d.envelopeAmount, 0) * 100) / 100;
    const totalDiff = Math.round((totalEnvelope - totalCounted) * 100) / 100;
    const daysWithData = historyDetails.filter((d) => d.countedAmount > 0).length;
    return { totalCounted, totalEnvelope, totalDiff, daysWithData, totalDays: historyDetails.length };
  }, [historyDetails]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        과거 2주 기간별 현금 매출 기록 조회
      </p>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1.5 min-w-[180px]">
          <Label>Store</Label>
          <Select value={historyStoreId} onValueChange={setHistoryStoreId}>
            <SelectTrigger data-testid="select-history-store">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {activeStores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 min-w-[260px]">
          <Label>Period</Label>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger data-testid="select-history-period">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {pastPeriods.map((p) => (
                <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!historyStoreId || !selectedPeriod ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          매장과 기간을 선택해 주세요
        </p>
      ) : historyLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm" data-testid="text-no-history">
              해당 기간에 저장된 기록이 없습니다
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <span className="text-xs text-muted-foreground">Counted Total</span>
                  <p className="text-lg font-bold tabular-nums" data-testid="text-history-total">
                    ${summary?.totalCounted.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Envelope Total</span>
                  <p className="text-lg tabular-nums" data-testid="text-history-envelope">
                    ${summary?.totalEnvelope.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Difference</span>
                  <p
                    className={`text-lg tabular-nums ${Math.abs(summary?.totalDiff || 0) >= 0.01 ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}
                    data-testid="text-history-diff"
                  >
                    ${summary?.totalDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Days</span>
                  <p className="text-lg tabular-nums">
                    {summary?.daysWithData} / {summary?.totalDays}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="gap-1"
                onClick={() => setModalOpen(true)}
                data-testid="button-view-detail"
              >
                <Eye className="h-3.5 w-3.5" />
                View Detail
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <CashSalesDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        details={historyDetails || []}
        storeName={storeName}
        periodLabel={selectedPeriod}
      />
    </div>
  );
}

function RecentCashSalesTransactions({ stores }: { stores: Store[] }) {
  const [modalTx, setModalTx] = useState<FinancialTransaction | null>(null);
  const [modalDetails, setModalDetails] = useState<CashSalesDetail[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const { data: transactions, isLoading } = useQuery<FinancialTransaction[]>({
    queryKey: ["/api/finance/transactions"],
  });

  const cashSalesTxs = useMemo(
    () => (transactions || []).filter((tx) => tx.transactionType === "CASH_SALES"),
    [transactions]
  );

  const getStoreName = (id: string | null) => {
    if (!id) return "—";
    return stores.find((s) => s.id === id)?.name || id;
  };

  const parsePeriodFromRef = (refNote: string | null): { start: string; end: string } | null => {
    if (!refNote) return null;
    const match = refNote.match(/\((\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})\)/);
    if (!match) return null;
    return { start: match[1], end: match[2] };
  };

  const handleViewDetail = async (tx: FinancialTransaction) => {
    const period = parsePeriodFromRef(tx.referenceNote);
    if (!period || !tx.toStoreId) return;

    setModalTx(tx);
    setModalLoading(true);
    try {
      const params = new URLSearchParams({
        store_id: tx.toStoreId,
        start_date: period.start,
        end_date: period.end,
      });
      const res = await fetch(`/api/cash-sales?${params}`);
      if (res.ok) {
        const data = await res.json();
        setModalDetails(data);
      }
    } finally {
      setModalLoading(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (cashSalesTxs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-recent-tx">
        현금 매출 거래 기록이 없습니다
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Store</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="text-center">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cashSalesTxs.slice(0, 20).map((tx) => (
            <TableRow key={tx.id} data-testid={`row-tx-${tx.id}`}>
              <TableCell className="text-sm tabular-nums whitespace-nowrap">
                {new Date(tx.executedAt).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" })}
              </TableCell>
              <TableCell className="text-sm">{getStoreName(tx.toStoreId)}</TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums font-medium">
                ${tx.cashAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                {tx.referenceNote || "—"}
              </TableCell>
              <TableCell className="text-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => handleViewDetail(tx)}
                  data-testid={`button-view-tx-${tx.id}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Detail
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {modalTx && (
        <CashSalesDetailModal
          open={!!modalTx}
          onOpenChange={(open) => { if (!open) { setModalTx(null); setModalDetails([]); } }}
          details={modalDetails}
          storeName={getStoreName(modalTx.toStoreId)}
          periodLabel={modalTx.referenceNote || ""}
        />
      )}
    </>
  );
}

export function AdminCashSales() {
  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  return (
    <AdminLayout title="Cash Sales">
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-4">
            {storesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="entry">
                <TabsList className="mb-4">
                  <TabsTrigger value="entry" data-testid="tab-entry" className="gap-1">
                    <Banknote className="h-3.5 w-3.5" />
                    Entry
                  </TabsTrigger>
                  <TabsTrigger value="history" data-testid="tab-history" className="gap-1">
                    <History className="h-3.5 w-3.5" />
                    History
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="entry">
                  <CashSalesEntry stores={stores || []} />
                </TabsContent>
                <TabsContent value="history">
                  <HistoryView stores={stores || []} />
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Banknote className="h-4 w-4" />
              Recent Cash Sales Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RecentCashSalesTransactions stores={stores || []} />
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
