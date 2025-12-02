import { useState, useEffect } from "react";
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
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store } from "@shared/schema";

export function MobileDailyClose() {
  const { toast } = useToast();
  const [storeId, setStoreId] = useState<string>("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [submitted, setSubmitted] = useState(false);

  const [closingForm, setClosingForm] = useState({
    staffNames: "",
    ubereatsAmount: 0,
    doordashAmount: 0,
    menulogAmount: 0,
    posSalesAmount: 0,
    floatAmount: 0,
    creditAmount: 0,
    notes: "",
  });

  const [cashForm, setCashForm] = useState({
    envelopeAmount: 0,
    note100Count: 0,
    note50Count: 0,
    note20Count: 0,
    note10Count: 0,
    note5Count: 0,
  });

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const countedAmount = 
    cashForm.note100Count * 100 +
    cashForm.note50Count * 50 +
    cashForm.note20Count * 20 +
    cashForm.note10Count * 10 +
    cashForm.note5Count * 5;

  const cashDifference = countedAmount - cashForm.envelopeAmount;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const closingData = {
        storeId,
        date,
        staffNames: closingForm.staffNames || null,
        ubereatsAmount: closingForm.ubereatsAmount,
        doordashAmount: closingForm.doordashAmount,
        menulogAmount: closingForm.menulogAmount,
        posSalesAmount: closingForm.posSalesAmount,
        floatAmount: closingForm.floatAmount,
        creditAmount: closingForm.creditAmount,
        differenceAmount: 0,
        notes: closingForm.notes || null,
      };

      const cashData = {
        storeId,
        date,
        envelopeAmount: cashForm.envelopeAmount,
        countedAmount,
        note100Count: cashForm.note100Count,
        note50Count: cashForm.note50Count,
        note20Count: cashForm.note20Count,
        note10Count: cashForm.note10Count,
        note5Count: cashForm.note5Count,
        differenceAmount: cashDifference,
      };

      await apiRequest("POST", "/api/daily-closings", closingData);
      await apiRequest("POST", "/api/cash-sales", cashData);

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-sales"] });
      setSubmitted(true);
      toast({ title: "Daily close submitted successfully!" });
    },
    onError: () => {
      toast({ title: "Failed to submit daily close", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSubmitted(false);
    setClosingForm({
      staffNames: "",
      ubereatsAmount: 0,
      doordashAmount: 0,
      menulogAmount: 0,
      posSalesAmount: 0,
      floatAmount: 0,
      creditAmount: 0,
      notes: "",
    });
    setCashForm({
      envelopeAmount: 0,
      note100Count: 0,
      note50Count: 0,
      note20Count: 0,
      note10Count: 0,
      note5Count: 0,
    });
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
            <p className="text-muted-foreground mb-6">Daily close has been recorded successfully.</p>
            <Button onClick={resetForm} className="w-full h-12" data-testid="button-new-close">
              Submit Another
            </Button>
          </CardContent>
        </Card>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout title="Daily Close">
      <div className="space-y-4 pb-24">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Store</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="h-12 text-base" data-testid="select-store">
                  <SelectValue placeholder="Select store" />
                </SelectTrigger>
                <SelectContent>
                  {stores?.filter(s => s.active).map(store => (
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

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Sales Amounts
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pos">POS Sales</Label>
                <Input
                  id="pos"
                  type="number"
                  step="0.01"
                  value={closingForm.posSalesAmount || ""}
                  onChange={(e) => setClosingForm({...closingForm, posSalesAmount: parseFloat(e.target.value) || 0})}
                  className="h-12 text-base"
                  data-testid="input-pos"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ubereats">UberEats</Label>
                <Input
                  id="ubereats"
                  type="number"
                  step="0.01"
                  value={closingForm.ubereatsAmount || ""}
                  onChange={(e) => setClosingForm({...closingForm, ubereatsAmount: parseFloat(e.target.value) || 0})}
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
                  onChange={(e) => setClosingForm({...closingForm, doordashAmount: parseFloat(e.target.value) || 0})}
                  className="h-12 text-base"
                  data-testid="input-doordash"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="menulog">Menulog</Label>
                <Input
                  id="menulog"
                  type="number"
                  step="0.01"
                  value={closingForm.menulogAmount || ""}
                  onChange={(e) => setClosingForm({...closingForm, menulogAmount: parseFloat(e.target.value) || 0})}
                  className="h-12 text-base"
                  data-testid="input-menulog"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="float">Float</Label>
                <Input
                  id="float"
                  type="number"
                  step="0.01"
                  value={closingForm.floatAmount || ""}
                  onChange={(e) => setClosingForm({...closingForm, floatAmount: parseFloat(e.target.value) || 0})}
                  className="h-12 text-base"
                  data-testid="input-float"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit">Credit</Label>
                <Input
                  id="credit"
                  type="number"
                  step="0.01"
                  value={closingForm.creditAmount || ""}
                  onChange={(e) => setClosingForm({...closingForm, creditAmount: parseFloat(e.target.value) || 0})}
                  className="h-12 text-base"
                  data-testid="input-credit"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Cash Count
            </h3>

            <div className="space-y-2">
              <Label htmlFor="envelope">Envelope Amount</Label>
              <Input
                id="envelope"
                type="number"
                step="0.01"
                value={cashForm.envelopeAmount || ""}
                onChange={(e) => setCashForm({...cashForm, envelopeAmount: parseFloat(e.target.value) || 0})}
                className="h-12 text-base"
                data-testid="input-envelope"
              />
            </div>

            <div className="grid grid-cols-5 gap-2">
              <div className="space-y-1 text-center">
                <Label className="text-xs">$100</Label>
                <Input
                  type="number"
                  value={cashForm.note100Count || ""}
                  onChange={(e) => setCashForm({...cashForm, note100Count: parseInt(e.target.value) || 0})}
                  className="h-12 text-center text-base"
                  data-testid="input-note100"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">$50</Label>
                <Input
                  type="number"
                  value={cashForm.note50Count || ""}
                  onChange={(e) => setCashForm({...cashForm, note50Count: parseInt(e.target.value) || 0})}
                  className="h-12 text-center text-base"
                  data-testid="input-note50"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">$20</Label>
                <Input
                  type="number"
                  value={cashForm.note20Count || ""}
                  onChange={(e) => setCashForm({...cashForm, note20Count: parseInt(e.target.value) || 0})}
                  className="h-12 text-center text-base"
                  data-testid="input-note20"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">$10</Label>
                <Input
                  type="number"
                  value={cashForm.note10Count || ""}
                  onChange={(e) => setCashForm({...cashForm, note10Count: parseInt(e.target.value) || 0})}
                  className="h-12 text-center text-base"
                  data-testid="input-note10"
                />
              </div>
              <div className="space-y-1 text-center">
                <Label className="text-xs">$5</Label>
                <Input
                  type="number"
                  value={cashForm.note5Count || ""}
                  onChange={(e) => setCashForm({...cashForm, note5Count: parseInt(e.target.value) || 0})}
                  className="h-12 text-center text-base"
                  data-testid="input-note5"
                />
              </div>
            </div>

            <div className="p-3 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Counted Total:</span>
                <span className="font-bold">${countedAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Difference:</span>
                <span className={`font-bold ${cashDifference !== 0 ? (cashDifference > 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                  {cashDifference > 0 ? '+' : ''}${cashDifference.toFixed(2)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

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
