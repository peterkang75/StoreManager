import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeftRight, Send, PenLine, AlertTriangle, Trash2, Bell, CheckCircle2, Check, Banknote, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CashBalances } from "@/components/CashBalances";
import { ConvertForm } from "@/components/ConvertForm";
import { CashSalesEntry } from "@/components/CashSalesEntry";
import type { Store, FinancialTransaction, CashSalesDetail } from "@shared/schema";

const DENOM_COLS = [
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

function RemittanceForm({ stores }: { stores: Store[] }) {
  const [fromStoreId, setFromStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeStores = stores.filter((s) => s.active);
  const hoStore = stores.find((s) => s.code.toUpperCase() === "HO" || s.name.toUpperCase() === "HO" || s.name.toUpperCase().includes("HEAD OFFICE"));
  const operatingStores = activeStores.filter((s) => s.id !== hoStore?.id);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!hoStore) throw new Error("HO (Head Office) store not found. Please create a store with code 'HO' first.");
      const res = await apiRequest("POST", "/api/finance/remittance", {
        fromStoreId,
        toStoreId: hoStore.id,
        amount: parseFloat(amount),
        referenceNote,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Remittance recorded successfully" });
      setFromStoreId("");
      setAmount("");
      setReferenceNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
      setTimeout(() => amountRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One-way cash transfer from operating store to HO. Cash only - no bank exchange.
      </p>
      {!hoStore && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>HO store not found. Create a store with code "HO" to use remittance.</span>
        </div>
      )}
      <div className="space-y-2">
        <Label>From Store</Label>
        <Select value={fromStoreId} onValueChange={setFromStoreId}>
          <SelectTrigger data-testid="select-remittance-from">
            <SelectValue placeholder="Select operating store" />
          </SelectTrigger>
          <SelectContent>
            {operatingStores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>To</Label>
        <Input value={hoStore ? hoStore.name : "HO not set"} disabled data-testid="input-remittance-to" />
      </div>
      <div className="space-y-2">
        <Label>Cash Amount ($)</Label>
        <Input
          ref={amountRef}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="input-remittance-amount"
        />
      </div>
      <div className="space-y-2">
        <Label>Reference Note</Label>
        <Textarea
          placeholder="e.g. Weekly cash remittance"
          value={referenceNote}
          onChange={(e) => setReferenceNote(e.target.value)}
          data-testid="input-remittance-note"
        />
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={!fromStoreId || !amount || !hoStore || mutation.isPending}
        data-testid="button-submit-remittance"
      >
        {mutation.isPending ? "Processing..." : "Record Remittance"}
      </Button>
    </div>
  );
}

function ManualEntryForm({ stores }: { stores: Store[] }) {
  const [txType, setTxType] = useState<string>("");
  const [storeId, setStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeStores = stores.filter((s) => s.active);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/manual", {
        transactionType: txType,
        storeId,
        amount: parseFloat(amount),
        referenceNote,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Manual entry recorded successfully" });
      setTxType("");
      setStoreId("");
      setAmount("");
      setReferenceNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
      setTimeout(() => amountRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>Need to move cash between stores? Use the <strong>Convert</strong> tab to prevent accounting errors.</span>
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={txType} onValueChange={setTxType}>
          <SelectTrigger data-testid="select-manual-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANUAL_INCOME">Income (Cash In)</SelectItem>
            <SelectItem value="MANUAL_EXPENSE">Expense (Cash Out)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Store</Label>
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger data-testid="select-manual-store">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {activeStores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Amount ($)</Label>
        <Input
          ref={amountRef}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="input-manual-amount"
        />
      </div>
      <div className="space-y-2">
        <Label>Reference Note</Label>
        <Textarea
          placeholder="Describe the income or expense"
          value={referenceNote}
          onChange={(e) => setReferenceNote(e.target.value)}
          data-testid="input-manual-note"
        />
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={!txType || !storeId || !amount || mutation.isPending}
        data-testid="button-submit-manual"
      >
        {mutation.isPending ? "Processing..." : "Record Entry"}
      </Button>
    </div>
  );
}

function TransactionTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "CONVERT":
      return <Badge variant="default" data-testid={`badge-type-${type}`}>Convert</Badge>;
    case "REMITTANCE":
      return <Badge variant="secondary" data-testid={`badge-type-${type}`}>Remittance</Badge>;
    case "MANUAL_INCOME":
      return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400" data-testid={`badge-type-${type}`}>Income</Badge>;
    case "MANUAL_EXPENSE":
      return <Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400" data-testid={`badge-type-${type}`}>Expense</Badge>;
    case "CASH_SALES":
      return <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400" data-testid={`badge-type-${type}`}>Cash Sales</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-type-${type}`}>{type}</Badge>;
  }
}

export function AdminFinance() {
  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: transactions, isLoading: txLoading } = useQuery<FinancialTransaction[]>({
    queryKey: ["/api/finance/transactions"],
  });

  const { toast } = useToast();

  const [cashSalesModalOpen, setCashSalesModalOpen] = useState(false);
  const [cashSalesModalDetails, setCashSalesModalDetails] = useState<CashSalesDetail[]>([]);
  const [cashSalesModalLabel, setCashSalesModalLabel] = useState("");
  const [cashSalesModalStore, setCashSalesModalStore] = useState("");

  const handleViewCashSalesTx = async (tx: FinancialTransaction) => {
    const match = tx.referenceNote?.match(/\((\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})\)/);
    if (!match || !tx.toStoreId) return;
    try {
      const params = new URLSearchParams({ store_id: tx.toStoreId, start_date: match[1], end_date: match[2] });
      const res = await fetch(`/api/cash-sales?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCashSalesModalDetails(data);
        setCashSalesModalLabel(tx.referenceNote || "");
        const store = stores?.find((s) => s.id === tx.toStoreId);
        setCashSalesModalStore(store?.name || "");
        setCashSalesModalOpen(true);
      }
    } catch { /* ignore */ }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/finance/transactions/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Transaction deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PUT", `/api/finance/transactions/${id}/settle`);
    },
    onSuccess: () => {
      toast({ title: "Bank transfer settled" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const storeMap = new Map<string, Store>();
  stores?.forEach((s) => storeMap.set(s.id, s));

  const getStoreName = (id: string | null) => {
    if (!id) return "-";
    const store = storeMap.get(id);
    return store ? store.name : id;
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const pendingBankTransfers = (transactions || []).filter(
    (tx) => tx.transactionType === "CONVERT" && !tx.isBankSettled
  );

  return (
    <AdminLayout title="Finance / Cash Flow">
      <div className="space-y-6">
        {!storesLoading && <CashBalances stores={stores || []} />}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction Entry</CardTitle>
          </CardHeader>
          <CardContent>
            {storesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="cashsales">
                <TabsList className="mb-4">
                  <TabsTrigger value="cashsales" data-testid="tab-cashsales" className="gap-1">
                    <Banknote className="h-3.5 w-3.5" />
                    Cash Sales Entry
                  </TabsTrigger>
                  <TabsTrigger value="convert" data-testid="tab-convert" className="gap-1">
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Convert
                  </TabsTrigger>
                  <TabsTrigger value="remittance" data-testid="tab-remittance" className="gap-1">
                    <Send className="h-3.5 w-3.5" />
                    Remittance (HO)
                  </TabsTrigger>
                  <TabsTrigger value="manual" data-testid="tab-manual" className="gap-1">
                    <PenLine className="h-3.5 w-3.5" />
                    Manual Entry
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="cashsales">
                  <CashSalesEntry stores={stores || []} />
                </TabsContent>
                <TabsContent value="convert">
                  <ConvertForm stores={stores || []} />
                </TabsContent>
                <TabsContent value="remittance">
                  <RemittanceForm stores={stores || []} />
                </TabsContent>
                <TabsContent value="manual">
                  <ManualEntryForm stores={stores || []} />
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        {pendingBankTransfers.length > 0 && (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>Pending Bank Transfers ({pendingBankTransfers.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingBankTransfers.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex-wrap"
                  data-testid={`pending-transfer-${tx.id}`}
                >
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <span className="text-amber-900 dark:text-amber-200">
                      Transfer <strong className="font-mono">${tx.bankAmount.toFixed(2)}</strong>{" "}
                      from <strong>{getStoreName(tx.fromStoreId)}</strong> to{" "}
                      <strong>{getStoreName(tx.toStoreId)}</strong>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({formatDateTime(tx.executedAt as unknown as string)})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => settleMutation.mutate(tx.id)}
                    disabled={settleMutation.isPending}
                    data-testid={`button-settle-${tx.id}`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Settled
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {txLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !transactions || transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-transactions">
                No transactions yet. Use the forms above to record your first transaction.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date/Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right">Bank</TableHead>
                      <TableHead className="min-w-[250px]">Reference Note</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDateTime(tx.executedAt as unknown as string)}
                        </TableCell>
                        <TableCell>
                          <TransactionTypeBadge type={tx.transactionType} />
                        </TableCell>
                        <TableCell className="text-sm">{getStoreName(tx.fromStoreId)}</TableCell>
                        <TableCell className="text-sm">{getStoreName(tx.toStoreId)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ${tx.cashAmount.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          <span className="inline-flex items-center gap-1">
                            {tx.bankAmount > 0 ? `$${tx.bankAmount.toFixed(2)}` : "-"}
                            {tx.transactionType === "CONVERT" && tx.isBankSettled && (
                              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {tx.referenceNote ? (
                            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded text-sm font-medium text-amber-900 dark:text-amber-200" data-testid={`text-note-${tx.id}`}>
                              {tx.referenceNote}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {tx.transactionType === "CASH_SALES" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleViewCashSalesTx(tx)}
                                data-testid={`button-view-cashsales-${tx.id}`}
                              >
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(tx.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-tx-${tx.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Dialog open={cashSalesModalOpen} onOpenChange={setCashSalesModalOpen}>
          <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <Banknote className="h-4 w-4" />
                Cash Sales Detail — {cashSalesModalStore}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{cashSalesModalLabel}</p>
            </DialogHeader>
            {cashSalesModalDetails.length > 0 ? (
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-2 py-1.5 text-left font-medium border-b border-r min-w-[85px]">Date</th>
                      <th className="px-2 py-1.5 text-right font-medium border-b border-r min-w-[80px]">Envelope</th>
                      {DENOM_COLS.map((d) => (
                        <th key={d.key} className="px-1 py-1.5 text-center font-medium border-b border-r min-w-[46px] text-xs">{d.label}</th>
                      ))}
                      <th className="px-2 py-1.5 text-right font-medium border-b border-r min-w-[80px] bg-muted/80">Counted</th>
                      <th className="px-2 py-1.5 text-right font-medium border-b min-w-[70px]">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cashSalesModalDetails].sort((a, b) => a.date.localeCompare(b.date)).map((row) => {
                      const d = new Date(row.date + "T00:00:00");
                      const dow = d.getDay();
                      const dayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow === 0 ? 6 : dow - 1];
                      const diff = Math.round((row.envelopeAmount - row.countedAmount) * 100) / 100;
                      const hasDiff = Math.abs(diff) >= 0.01;
                      const shortDate = `${parseInt(row.date.split("-")[1])}/${parseInt(row.date.split("-")[2])}`;
                      return (
                        <tr key={row.date}>
                          <td className="px-2 py-1 border-b border-r font-mono text-xs whitespace-nowrap">
                            <span className="text-muted-foreground mr-1">{dayLabel}</span>{shortDate}
                          </td>
                          <td className="px-2 py-1 border-b border-r text-right font-mono text-xs tabular-nums">
                            {row.envelopeAmount > 0 ? `$${row.envelopeAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                          </td>
                          {DENOM_COLS.map((dc) => {
                            const val = (row as any)[dc.key] || 0;
                            return (
                              <td key={dc.key} className="px-1 py-1 border-b border-r text-center font-mono text-xs tabular-nums text-muted-foreground">
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
                    {(() => {
                      const sorted = [...cashSalesModalDetails].sort((a, b) => a.date.localeCompare(b.date));
                      const tCounted = Math.round(sorted.reduce((s, r) => s + r.countedAmount, 0) * 100) / 100;
                      const tEnv = Math.round(sorted.reduce((s, r) => s + r.envelopeAmount, 0) * 100) / 100;
                      const tDiff = Math.round((tEnv - tCounted) * 100) / 100;
                      return (
                        <tr className="bg-muted/60 font-medium">
                          <td className="px-2 py-2 border-t-2 text-xs font-bold">TOTAL</td>
                          <td className="px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums">${tEnv.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          {DENOM_COLS.map((dc) => {
                            const colTotal = sorted.reduce((s, r) => s + ((r as any)[dc.key] || 0), 0);
                            return <td key={dc.key} className="px-1 py-2 border-t-2 text-center font-mono text-xs tabular-nums text-muted-foreground">{colTotal > 0 ? colTotal : ""}</td>;
                          })}
                          <td className="px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums font-bold bg-muted/80">${tCounted.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className={`px-2 py-2 border-t-2 text-right font-mono text-xs tabular-nums ${Math.abs(tDiff) >= 0.01 ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}`}>
                            {Math.abs(tDiff) >= 0.01 ? `$${tDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">해당 기간에 저장된 기록이 없습니다</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
