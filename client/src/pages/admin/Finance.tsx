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
import { ArrowLeftRight, Send, PenLine, AlertTriangle, Trash2, Bell, CheckCircle2, Check, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store, FinancialTransaction } from "@shared/schema";

function ConvertForm({ stores }: { stores: Store[] }) {
  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeStores = stores.filter((s) => s.active);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/convert", {
        fromStoreId,
        toStoreId,
        amount: parseFloat(amount),
        referenceNote,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Convert recorded successfully" });
      setFromStoreId("");
      setToStoreId("");
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

  const availableToStores = activeStores.filter((s) => s.id !== fromStoreId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Two-way cash/bank exchange between operating stores. Store A sends cash, Store B sends equivalent bank transfer.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>From Store (Cash Out)</Label>
          <Select value={fromStoreId} onValueChange={(v) => { setFromStoreId(v); if (v === toStoreId) setToStoreId(""); }}>
            <SelectTrigger data-testid="select-convert-from">
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
          <Label>To Store (Cash In)</Label>
          <Select value={toStoreId} onValueChange={setToStoreId}>
            <SelectTrigger data-testid="select-convert-to">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {availableToStores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          data-testid="input-convert-amount"
        />
      </div>
      <div className="space-y-2">
        <Label>Reference Note / Memo</Label>
        <Textarea
          placeholder="e.g. [Temp Loan - Meat to reimburse tomorrow]"
          value={referenceNote}
          onChange={(e) => setReferenceNote(e.target.value)}
          data-testid="input-convert-note"
        />
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={!fromStoreId || !toStoreId || !amount || mutation.isPending}
        data-testid="button-submit-convert"
      >
        {mutation.isPending ? "Processing..." : "Record Convert"}
      </Button>
    </div>
  );
}

function RemittanceForm({ stores }: { stores: Store[] }) {
  const [fromStoreId, setFromStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeStores = stores.filter((s) => s.active);
  const hoStore = stores.find((s) => s.code.toUpperCase() === "HO" || s.name.toUpperCase().includes("HEAD OFFICE"));
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
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        운영 매장에서 본사(HO)로의 단방향 현금 이체. 현금만 가능 - 은행 교환 없음.
      </p>
      {!hoStore && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>본사(HO) 매장을 찾을 수 없습니다. 송금 기능을 사용하려면 코드 "HO"로 매장을 생성하세요.</span>
        </div>
      )}
      <div className="space-y-2">
        <Label>보내는 매장</Label>
        <Select value={fromStoreId} onValueChange={setFromStoreId}>
          <SelectTrigger data-testid="select-remittance-from">
            <SelectValue placeholder="운영 매장 선택" />
          </SelectTrigger>
          <SelectContent>
            {operatingStores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>받는 곳</Label>
        <Input value={hoStore ? hoStore.name : "HO 미설정"} disabled data-testid="input-remittance-to" />
      </div>
      <div className="space-y-2">
        <Label>현금 금액 ($)</Label>
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
        <Label>참고 메모</Label>
        <Textarea
          placeholder="예: 주간 현금 송금"
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
        {mutation.isPending ? "처리 중..." : "송금 기록"}
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
      toast({ title: "수동 입력이 성공적으로 기록되었습니다" });
      setTxType("");
      setStoreId("");
      setAmount("");
      setReferenceNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
      setTimeout(() => amountRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>매장 간 현금 이동이 필요하신가요? 회계 오류를 방지하려면 <strong>환전</strong> 탭을 사용하세요.</span>
      </div>
      <div className="space-y-2">
        <Label>유형</Label>
        <Select value={txType} onValueChange={setTxType}>
          <SelectTrigger data-testid="select-manual-type">
            <SelectValue placeholder="유형 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANUAL_INCOME">수입 (현금 입금)</SelectItem>
            <SelectItem value="MANUAL_EXPENSE">지출 (현금 출금)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>매장</Label>
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger data-testid="select-manual-store">
            <SelectValue placeholder="매장 선택" />
          </SelectTrigger>
          <SelectContent>
            {activeStores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>금액 ($)</Label>
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
        <Label>참고 메모</Label>
        <Textarea
          placeholder="수입 또는 지출 내용을 설명하세요"
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
        {mutation.isPending ? "처리 중..." : "항목 기록"}
      </Button>
    </div>
  );
}

function TransactionTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "CONVERT":
      return <Badge variant="default" data-testid={`badge-type-${type}`}>환전</Badge>;
    case "REMITTANCE":
      return <Badge variant="secondary" data-testid={`badge-type-${type}`}>송금</Badge>;
    case "MANUAL_INCOME":
      return <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400" data-testid={`badge-type-${type}`}>수입</Badge>;
    case "MANUAL_EXPENSE":
      return <Badge variant="outline" className="border-red-500 text-red-700 dark:text-red-400" data-testid={`badge-type-${type}`}>지출</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-type-${type}`}>{type}</Badge>;
  }
}

function LegacyImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/finance/import-legacy-converts", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: `가져오기 완료: ${data.imported}건의 거래가 가져와졌습니다` });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({ title: "가져오기 실패", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        레거시 TSV 파일 (Cash Manager - Transaction.tsv)을 업로드하여 과거 환전 거래를 가져옵니다.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          ref={fileRef}
          type="file"
          accept=".tsv,.txt,.csv"
          className="max-w-xs"
          data-testid="input-legacy-file"
        />
        <Button
          onClick={() => {
            const file = fileRef.current?.files?.[0];
            if (file) mutation.mutate(file);
          }}
          disabled={mutation.isPending}
          data-testid="button-import-legacy"
        >
          {mutation.isPending ? "가져오는 중..." : "가져오기"}
        </Button>
      </div>
      {result && (
        <div className="text-sm space-y-1 p-3 rounded-md bg-muted">
          <p data-testid="text-import-result">
            가져옴: <strong>{result.imported}</strong> | 건너뜀: <strong>{result.skipped}</strong>
          </p>
          {result.errors.length > 0 && (
            <div className="text-destructive">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminFinance() {
  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: transactions, isLoading: txLoading } = useQuery<FinancialTransaction[]>({
    queryKey: ["/api/finance/transactions"],
  });

  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/finance/transactions/${id}`);
    },
    onSuccess: () => {
      toast({ title: "거래가 삭제되었습니다" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PUT", `/api/finance/transactions/${id}/settle`);
    },
    onSuccess: () => {
      toast({ title: "이체 완료 처리되었습니다" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/balances"] });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
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
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const displayNames = ["Sushi", "Sandwich", "Meat", "Trading", "HO"];

  const { data: serverBalances } = useQuery<Record<string, number>>({
    queryKey: ["/api/finance/balances"],
  });

  const balances = displayNames
    .map((dn) => {
      if (!serverBalances) return null;
      const cash = serverBalances[dn];
      if (cash === undefined) return null;
      return { name: dn, code: dn, cash };
    })
    .filter(Boolean) as { name: string; code: string; cash: number }[];

  const pendingBankTransfers = (transactions || []).filter(
    (tx) => tx.transactionType === "CONVERT" && !tx.isBankSettled
  );

  return (
    <AdminLayout title="재무 / 자금 흐름">
      <div className="space-y-6">
        {!storesLoading && balances.length > 0 && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {balances.map((b) => (
              <Card key={b.code}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-muted-foreground" data-testid={`text-balance-name-${b.code}`}>
                    {b.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <span
                    className={`text-xl font-bold font-mono ${b.cash < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid={`text-balance-cash-${b.code}`}
                  >
                    ${b.cash.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <p className="text-xs text-muted-foreground mt-1">현금 잔액</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">거래 기록</CardTitle>
          </CardHeader>
          <CardContent>
            {storesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="convert">
                <TabsList className="mb-4">
                  <TabsTrigger value="convert" data-testid="tab-convert" className="gap-1">
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    환전
                  </TabsTrigger>
                  <TabsTrigger value="remittance" data-testid="tab-remittance" className="gap-1">
                    <Send className="h-3.5 w-3.5" />
                    송금 (본사)
                  </TabsTrigger>
                  <TabsTrigger value="manual" data-testid="tab-manual" className="gap-1">
                    <PenLine className="h-3.5 w-3.5" />
                    수동 입력
                  </TabsTrigger>
                </TabsList>
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Upload className="h-4 w-4" />
              레거시 데이터 가져오기 (TSV)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LegacyImport />
          </CardContent>
        </Card>

        {pendingBankTransfers.length > 0 && (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>은행 이체 대기 ({pendingBankTransfers.length}건)</span>
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
                      <strong>{getStoreName(tx.fromStoreId)}</strong>에서{" "}
                      <strong>{getStoreName(tx.toStoreId)}</strong>로{" "}
                      <strong className="font-mono">${tx.bankAmount.toFixed(2)}</strong>{" "}
                      이체 필요
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
                    이체 완료
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 금융 거래</CardTitle>
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
                거래 내역이 없습니다. 위의 양식을 사용하여 첫 번째 거래를 기록하세요.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>날짜/시간</TableHead>
                      <TableHead>유형</TableHead>
                      <TableHead>보내는 곳</TableHead>
                      <TableHead>받는 곳</TableHead>
                      <TableHead className="text-right">현금</TableHead>
                      <TableHead className="text-right">은행</TableHead>
                      <TableHead className="min-w-[250px]">참고 메모</TableHead>
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
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(tx.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-tx-${tx.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
