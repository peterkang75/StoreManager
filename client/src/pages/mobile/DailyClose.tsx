import { useState, useMemo } from "react";
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
import { Wallet, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store } from "@shared/schema";

const ALL_DENOMS = [
  { key: "note100Count", label: "$100", value: 100 },
  { key: "note50Count",  label: "$50",  value: 50 },
  { key: "note20Count",  label: "$20",  value: 20 },
  { key: "note10Count",  label: "$10",  value: 10 },
  { key: "note5Count",   label: "$5",   value: 5 },
  { key: "coin2Count",   label: "$2",   value: 2 },
  { key: "coin1Count",   label: "$1",   value: 1 },
  { key: "coin050Count", label: "50c",  value: 0.5 },
  { key: "coin020Count", label: "20c",  value: 0.2 },
  { key: "coin010Count", label: "10c",  value: 0.1 },
  { key: "coin005Count", label: "5c",   value: 0.05 },
] as const;

type DenomCounts = Record<typeof ALL_DENOMS[number]["key"], number>;

function emptyDenoms(): DenomCounts {
  const d = {} as DenomCounts;
  for (const denom of ALL_DENOMS) d[denom.key] = 0;
  return d;
}

export function MobileDailyClose() {
  const { toast } = useToast();
  const [storeId, setStoreId] = useState<string>("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [submitted, setSubmitted] = useState(false);
  const [submitterName, setSubmitterName] = useState("");

  const [closingForm, setClosingForm] = useState({
    staffNames: "",
    previousFloat: 0,
    salesTotal: 0,
    cashSales: 0,
    cashOut: 0,
    nextFloat: 0,
    ubereatsAmount: 0,
    doordashAmount: 0,
    notes: "",
  });

  const [denoms, setDenoms] = useState<DenomCounts>(emptyDenoms);
  const [envelopeAmount, setEnvelopeAmount] = useState(0);

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const totalCounted = useMemo(() => {
    let sum = 0;
    for (const d of ALL_DENOMS) sum += (denoms[d.key] || 0) * d.value;
    return Math.round(sum * 100) / 100;
  }, [denoms]);

  const expectedCash = closingForm.previousFloat + closingForm.cashSales - closingForm.cashOut;
  const differenceAmount = expectedCash - totalCounted;
  const creditAmount = totalCounted - closingForm.nextFloat;
  const envelopeDiff = totalCounted - envelopeAmount;

  const updateDenom = (key: typeof ALL_DENOMS[number]["key"], val: string) => {
    setDenoms(prev => ({ ...prev, [key]: parseInt(val) || 0 }));
  };

  const updateClosing = (field: string, value: string) => {
    setClosingForm(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const closingData = {
        storeId,
        date,
        staffNames: closingForm.staffNames || null,
        previousFloat: closingForm.previousFloat,
        salesTotal: closingForm.salesTotal,
        cashSales: closingForm.cashSales,
        cashOut: closingForm.cashOut,
        nextFloat: closingForm.nextFloat,
        actualCashCounted: totalCounted,
        differenceAmount,
        creditAmount,
        ubereatsAmount: closingForm.ubereatsAmount,
        doordashAmount: closingForm.doordashAmount,
        notes: closingForm.notes || null,
      };

      const closeFormData = {
        storeId,
        date,
        submitterName: submitterName || null,
        envelopeAmount,
        totalCalculated: totalCounted,
        notes: closingForm.notes || null,
        ...denoms,
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
    setSubmitterName("");
    setClosingForm({
      staffNames: "",
      previousFloat: 0,
      salesTotal: 0,
      cashSales: 0,
      cashOut: 0,
      nextFloat: 0,
      ubereatsAmount: 0,
      doordashAmount: 0,
      notes: "",
    });
    setDenoms(emptyDenoms());
    setEnvelopeAmount(0);
  };

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
            <Button onClick={resetForm} className="w-full h-12" data-testid="button-new-close">
              Submit Another
            </Button>
          </CardContent>
        </Card>
      </MobileLayout>
    );
  }

  const NOTE_DENOMS = ALL_DENOMS.filter(d => d.value >= 5);
  const COIN_DENOMS = ALL_DENOMS.filter(d => d.value < 5);

  return (
    <MobileLayout title="Daily Close">
      <div className="space-y-4 pb-24">
        {/* Basic Info */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Store</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="h-12 text-base" data-testid="select-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.filter(s => s.active && !s.isExternal).map(store => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label htmlFor="submitter">Submitted By</Label>
              <Input
                id="submitter"
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                placeholder="Your name"
                className="h-12 text-base"
                data-testid="input-submitter"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff">Staff on Duty</Label>
              <Textarea
                id="staff"
                value={closingForm.staffNames}
                onChange={(e) => setClosingForm({...closingForm, staffNames: e.target.value})}
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
                { id: "salesTotal", label: "Sales Total" },
                { id: "cashSales", label: "Cash Sales" },
                { id: "cashOut", label: "Cash Out" },
                { id: "nextFloat", label: "Next Float" },
              ].map(({ id, label }) => (
                <div key={id} className="space-y-2">
                  <Label htmlFor={id}>{label}</Label>
                  <Input
                    id={id}
                    type="number"
                    step="0.01"
                    value={(closingForm as any)[id] || ""}
                    onChange={(e) => updateClosing(id, e.target.value)}
                    className="h-12 text-base"
                    data-testid={`input-${id}`}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ubereats">UberEats</Label>
                <Input
                  id="ubereats"
                  type="number"
                  step="0.01"
                  value={closingForm.ubereatsAmount || ""}
                  onChange={(e) => updateClosing("ubereatsAmount", e.target.value)}
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
                  value={closingForm.doordashAmount || ""}
                  onChange={(e) => updateClosing("doordashAmount", e.target.value)}
                  className="h-12 text-base"
                  data-testid="input-doordash"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cash Count */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Cash Count
            </h3>

            <div className="space-y-2">
              <Label htmlFor="envelope">Envelope Amount (POS Total)</Label>
              <Input
                id="envelope"
                type="number"
                step="0.01"
                value={envelopeAmount || ""}
                onChange={(e) => setEnvelopeAmount(parseFloat(e.target.value) || 0)}
                className="h-12 text-base"
                data-testid="input-envelope"
              />
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Notes</p>
              <div className="grid grid-cols-5 gap-2">
                {NOTE_DENOMS.map(d => (
                  <div key={d.key} className="space-y-1 text-center">
                    <Label className="text-xs font-semibold">{d.label}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={denoms[d.key] || ""}
                      onChange={(e) => updateDenom(d.key, e.target.value)}
                      className="h-12 text-center text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      data-testid={`input-${d.key}`}
                    />
                    {denoms[d.key] > 0 && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        ${(denoms[d.key] * d.value).toFixed(0)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Coins</p>
              <div className="grid grid-cols-4 gap-2">
                {COIN_DENOMS.map(d => (
                  <div key={d.key} className="space-y-1 text-center">
                    <Label className="text-xs font-semibold">{d.label}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={denoms[d.key] || ""}
                      onChange={(e) => updateDenom(d.key, e.target.value)}
                      className="h-12 text-center text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      data-testid={`input-${d.key}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-muted rounded-md space-y-2">
              <div className="flex justify-between gap-1">
                <span className="text-muted-foreground text-sm">Counted Total:</span>
                <span className="font-bold text-lg" data-testid="text-counted-total">${totalCounted.toFixed(2)}</span>
              </div>
              {envelopeAmount > 0 && (
                <div className="flex justify-between gap-1">
                  <span className="text-muted-foreground text-sm">Envelope Diff:</span>
                  <span className={`font-semibold ${envelopeDiff !== 0 ? (envelopeDiff > 0 ? "text-green-600" : "text-red-600") : ""}`} data-testid="text-envelope-diff">
                    {envelopeDiff > 0 ? "+" : ""}${envelopeDiff.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Reconciliation */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Reconciliation Summary
            </h3>

            <div className="p-4 bg-muted rounded-md space-y-3">
              <div className="flex justify-between gap-1">
                <span className="font-semibold">Expected Cash:</span>
                <span className="font-bold text-lg" data-testid="text-expected-cash">${expectedCash.toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground -mt-2">Prev Float + Cash Sales − Cash Out</div>

              <div className="border-t pt-3">
                <div className="flex justify-between gap-1 items-center">
                  <span className="font-semibold">Difference:</span>
                  <span
                    className={`font-bold text-lg ${differenceAmount > 0 ? "text-red-600" : differenceAmount < 0 ? "text-green-600" : ""}`}
                    data-testid="text-difference"
                  >
                    ${differenceAmount.toFixed(2)}
                    {differenceAmount > 0 && <span className="text-xs ml-1">(Shortage)</span>}
                    {differenceAmount < 0 && <span className="text-xs ml-1">(Overage)</span>}
                  </span>
                </div>
                {differenceAmount > 0 && (
                  <div className="flex items-center gap-1 mt-1 text-red-600 text-xs">
                    <AlertTriangle className="w-3 h-3" />
                    <span>현금 부족이 감지되었습니다</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between gap-1">
                  <span className="font-semibold">Credit Amount:</span>
                  <span className="font-bold text-lg" data-testid="text-credit">${creditAmount.toFixed(2)}</span>
                </div>
                <div className="text-xs text-muted-foreground">Actual Cash − Next Float</div>
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
                value={closingForm.notes}
                onChange={(e) => setClosingForm({...closingForm, notes: e.target.value})}
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
