import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MobileLayout } from "@/components/layouts/MobileLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useMobileSession } from "@/hooks/use-mobile-session";
import {
  Wallet,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  KeyRound,
  LogOut,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store } from "@shared/schema";

const NOTE_DENOMS = [
  { key: "note100Count", label: "$100", value: 100 },
  { key: "note50Count",  label: "$50",  value: 50 },
  { key: "note20Count",  label: "$20",  value: 20 },
  { key: "note10Count",  label: "$10",  value: 10 },
  { key: "note5Count",   label: "$5",   value: 5 },
] as const;

type NoteDenomKey = typeof NOTE_DENOMS[number]["key"];
type NoteCounts = Record<NoteDenomKey, number>;

function emptyNotes(): NoteCounts {
  return {
    note100Count: 0,
    note50Count: 0,
    note20Count: 0,
    note10Count: 0,
    note5Count: 0,
  };
}

function PinEntry({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const { setSession } = useMobileSession();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) submit(next);
  };

  const submit = async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/mobile/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: p }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPin("");
        setError(data.error || "PIN이 올바르지 않습니다");
        setLoading(false);
        return;
      }
      setSession(data);
      onSuccess();
    } catch {
      setPin("");
      setError("네트워크 오류가 발생했습니다");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <KeyRound className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Daily Close</h1>
        <p className="text-muted-foreground mt-1">PIN을 입력하세요</p>
      </div>

      <div className="flex gap-3">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`w-14 h-14 rounded-md border-2 flex items-center justify-center text-2xl font-bold transition-colors ${
              pin.length > i ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            {pin.length > i ? "•" : ""}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium -mt-4">{error}</p>
      )}

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
          <Button
            key={i}
            variant={d === "" ? "ghost" : "outline"}
            className="h-16 text-xl font-semibold"
            disabled={loading || d === ""}
            onClick={() => {
              if (d === "⌫") { setPin(p => p.slice(0, -1)); setError(""); }
              else if (d) handleDigit(d);
            }}
            data-testid={d === "⌫" ? "button-backspace" : d ? `button-digit-${d}` : undefined}
          >
            {loading && d === "0" ? <Loader2 className="w-5 h-5 animate-spin" /> : d}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function MobileDailyClose() {
  const { toast } = useToast();
  const { session, clearSession } = useMobileSession();
  const [pinDone, setPinDone] = useState(!!session);

  const [storeId, setStoreId] = useState<string>("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    staffNames: "",
    previousFloat: 0,
    salesTotal: 0,
    cashSales: 0,
    cashOutTotal: 0,
    numberOfReceipts: 0,
    nextFloat: 0,
    ubereatsAmount: 0,
    doordashAmount: 0,
    notes: "",
  });

  const [notes, setNotes] = useState<NoteCounts>(emptyNotes);

  // Auto-select store when session loads or stores data arrives
  useEffect(() => {
    if (!session) return;
    const assignedIds = session.storeIds ?? [];
    if (assignedIds.length === 1) {
      setStoreId(assignedIds[0]);
    } else if (assignedIds.length === 0 && session.storeId) {
      setStoreId(session.storeId);
    }
    // length > 1: leave blank so user must choose
  }, [session]);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const totalCounted = useMemo(() => {
    let sum = 0;
    for (const d of NOTE_DENOMS) sum += (notes[d.key] || 0) * d.value;
    return Math.round(sum * 100) / 100;
  }, [notes]);

  // expectedCredit = Prev Float + Cash Sales - Cash Out Total - Next Float
  const expectedCredit = form.previousFloat + form.cashSales - form.cashOutTotal - form.nextFloat;
  // difference = Expected Credit - Counted Total (shortage is positive)
  const differenceAmount = expectedCredit - totalCounted;

  const updateNote = (key: NoteDenomKey, val: string) => {
    setNotes(prev => ({ ...prev, [key]: parseInt(val) || 0 }));
  };

  const updateForm = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const closingData = {
        storeId,
        date,
        staffNames: form.staffNames || null,
        previousFloat: form.previousFloat,
        salesTotal: form.salesTotal,
        cashSales: form.cashSales,
        cashOut: form.cashOutTotal,
        nextFloat: form.nextFloat,
        actualCashCounted: totalCounted,
        differenceAmount,
        creditAmount: expectedCredit,
        ubereatsAmount: form.ubereatsAmount,
        doordashAmount: form.doordashAmount,
        notes: form.notes || null,
      };

      // envelopeAmount = expectedCredit (for CashSalesEntry auto-fill mapping)
      const closeFormData = {
        storeId,
        date,
        submitterName: session?.name || null,
        envelopeAmount: expectedCredit,
        totalCalculated: totalCounted,
        numberOfReceipts: form.numberOfReceipts,
        notes: form.notes || null,
        ...notes,
        // coin fields default to 0 (still in DB schema, just not entered)
        coin2Count: 0,
        coin1Count: 0,
        coin050Count: 0,
        coin020Count: 0,
        coin010Count: 0,
        coin005Count: 0,
      };

      await apiRequest("POST", "/api/daily-closings", closingData);
      await apiRequest("POST", "/api/daily-close-forms", closeFormData);

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setSubmitted(true);
      toast({ title: "일일 마감이 성공적으로 제출되었습니다!" });
    },
    onError: () => {
      toast({ title: "일일 마감 제출에 실패했습니다", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSubmitted(false);
    setForm({
      staffNames: "",
      previousFloat: 0,
      salesTotal: 0,
      cashSales: 0,
      cashOutTotal: 0,
      numberOfReceipts: 0,
      nextFloat: 0,
      ubereatsAmount: 0,
      doordashAmount: 0,
      notes: "",
    });
    setNotes(emptyNotes());
  };

  if (!pinDone) {
    return <PinEntry onSuccess={() => setPinDone(true)} />;
  }

  if (storesLoading) {
    return (
      <MobileLayout title="Daily Close">
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </MobileLayout>
    );
  }

  if (submitted) {
    return (
      <MobileLayout title="Daily Close">
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-600" />
            <h2 className="text-2xl font-bold mb-2" data-testid="text-success-title">Submitted!</h2>
            <p className="text-muted-foreground mb-6">일일 마감이 성공적으로 기록되었습니다.</p>
            <div className="space-y-3">
              <Button onClick={resetForm} className="w-full h-12" data-testid="button-new-close">
                Submit Another
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={() => {
                clearSession();
                setPinDone(false);
              }} data-testid="button-logout">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </MobileLayout>
    );
  }

  const assignedIds = session?.storeIds ?? [];
  const assignedStores = stores?.filter(s => assignedIds.includes(s.id)) ?? [];
  const lockedStore = storeId && stores ? stores.find(s => s.id === storeId) : null;
  const isStoreLocked = assignedIds.length === 1;

  return (
    <MobileLayout title="Daily Close">
      <div className="space-y-4 pb-24">
        {/* Session Info Banner */}
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-semibold">{session?.name ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground capitalize">{(session?.role ?? "").toLowerCase()}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { clearSession(); setPinDone(false); }} data-testid="button-signout">
            <LogOut className="w-4 h-4 mr-1" />
            Sign Out
          </Button>
        </div>

        {/* Store & Date */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Store</Label>
              {isStoreLocked ? (
                <div className="h-12 flex items-center px-3 rounded-md border bg-muted text-base font-medium" data-testid="text-store-locked">
                  {lockedStore?.name ?? "—"}
                </div>
              ) : (
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger className="h-12 text-base" data-testid="select-store">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {(assignedStores.length > 0 ? assignedStores : stores?.filter(s => s.active && !s.isExternal) ?? []).map(store => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-12 text-base"
                data-testid="input-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Submitted By</Label>
              <div className="h-12 flex items-center px-3 rounded-md border bg-muted text-base" data-testid="text-submitter-locked">
                {session?.name ?? "—"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff">Staff on Duty</Label>
              <Textarea
                id="staff"
                value={form.staffNames}
                onChange={(e) => setForm({ ...form, staffNames: e.target.value })}
                placeholder="Enter staff names"
                className="text-base"
                data-testid="input-staff"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sales & Float */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Sales & Float
            </h3>

            <div className="grid grid-cols-2 gap-4">
              {[
                { id: "previousFloat", label: "Previous Float" },
                { id: "salesTotal",    label: "Sales Total" },
                { id: "cashSales",     label: "Cash Sales" },
                { id: "nextFloat",     label: "Next Float" },
              ].map(({ id, label }) => (
                <div key={id} className="space-y-2">
                  <Label htmlFor={id}>{label}</Label>
                  <Input
                    id={id}
                    type="number"
                    step="0.01"
                    value={(form as any)[id] || ""}
                    onChange={(e) => updateForm(id, e.target.value)}
                    className="h-12 text-base"
                    data-testid={`input-${id}`}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cashOutTotal">Cash Out Total</Label>
                <Input
                  id="cashOutTotal"
                  type="number"
                  step="0.01"
                  value={form.cashOutTotal || ""}
                  onChange={(e) => updateForm("cashOutTotal", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-cashOutTotal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="numberOfReceipts">No. of Receipts</Label>
                <Input
                  id="numberOfReceipts"
                  type="number"
                  step="1"
                  min="0"
                  value={form.numberOfReceipts || ""}
                  onChange={(e) => setForm(prev => ({ ...prev, numberOfReceipts: parseInt(e.target.value) || 0 }))}
                  className="h-12 text-base"
                  data-testid="input-numberOfReceipts"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ubereats">UberEats</Label>
                <Input
                  id="ubereats"
                  type="number"
                  step="0.01"
                  value={form.ubereatsAmount || ""}
                  onChange={(e) => updateForm("ubereatsAmount", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-ubereats"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doordash">DoorDash</Label>
                <Input
                  id="doordash"
                  type="number"
                  step="0.01"
                  value={form.doordashAmount || ""}
                  onChange={(e) => updateForm("doordashAmount", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-doordash"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes Count */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Note Count
            </h3>

            <div className="grid grid-cols-5 gap-2">
              {NOTE_DENOMS.map(d => (
                <div key={d.key} className="space-y-1 text-center">
                  <Label className="text-xs font-semibold">{d.label}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={notes[d.key] || ""}
                    onChange={(e) => updateNote(d.key, e.target.value)}
                    className="h-14 text-center text-lg font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    data-testid={`input-${d.key}`}
                  />
                  {notes[d.key] > 0 && (
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      ${(notes[d.key] * d.value).toFixed(0)}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="p-3 bg-muted rounded-md">
              <div className="flex justify-between gap-1">
                <span className="text-muted-foreground text-sm">Counted Total:</span>
                <span className="font-bold text-xl" data-testid="text-counted-total">${totalCounted.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reconciliation */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Reconciliation
            </h3>

            <div className="p-4 bg-muted rounded-md space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between gap-1">
                  <span className="font-semibold">Expected Credit:</span>
                  <span className="font-bold text-xl" data-testid="text-expected-credit">${expectedCredit.toFixed(2)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Prev Float + Cash Sales − Cash Out − Next Float
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  ${form.previousFloat.toFixed(2)} + ${form.cashSales.toFixed(2)} − ${form.cashOutTotal.toFixed(2)} − ${form.nextFloat.toFixed(2)}
                </div>
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between gap-1 items-center">
                  <span className="font-semibold">Difference:</span>
                  <span
                    className={`font-bold text-xl ${differenceAmount > 0.005 ? "text-red-600" : differenceAmount < -0.005 ? "text-green-600" : ""}`}
                    data-testid="text-difference"
                  >
                    {differenceAmount > 0.005 && "+"}${differenceAmount.toFixed(2)}
                    {differenceAmount > 0.005 && <span className="text-xs ml-1">(Shortage)</span>}
                    {differenceAmount < -0.005 && <span className="text-xs ml-1">(Overage)</span>}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">Expected Credit − Counted Total</div>
                {differenceAmount > 0.005 && (
                  <div className="flex items-center gap-1 mt-2 text-red-600 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <span>현금 부족이 감지되었습니다</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any additional notes..."
                className="text-base"
                data-testid="input-notes"
              />
            </div>
          </CardContent>
        </Card>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold"
            onClick={() => submitMutation.mutate()}
            disabled={!storeId || !date || submitMutation.isPending}
            data-testid="button-submit"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Wallet className="w-5 h-5 mr-2" />
            )}
            Submit Daily Close
          </Button>
        </div>
      </div>
    </MobileLayout>
  );
}
