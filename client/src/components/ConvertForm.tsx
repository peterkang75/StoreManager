import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store } from "@shared/schema";

type Mode = "convert" | "remittance";

export function ConvertForm({ stores }: { stores: Store[] }) {
  const [mode, setMode] = useState<Mode>("convert");
  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const activeStores = stores.filter((s) => s.active);
  const hoStore = activeStores.find((s) => s.name.toUpperCase() === "HO");

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setFromStoreId("");
    setToStoreId(newMode === "remittance" && hoStore ? hoStore.id : "");
    setAmount("");
    setReferenceNote("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const endpoint = mode === "convert" ? "/api/finance/convert" : "/api/finance/remittance";
      const res = await apiRequest("POST", endpoint, {
        fromStoreId,
        toStoreId,
        amount: parseFloat(amount),
        referenceNote,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: mode === "convert" ? "Convert recorded successfully" : "Remittance recorded successfully" });
      setFromStoreId("");
      setToStoreId(mode === "remittance" && hoStore ? hoStore.id : "");
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
  const operatingStores = activeStores.filter((s) => !s.isExternal && s.name.toUpperCase() !== "HO");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "convert" ? "default" : "outline"}
          onClick={() => handleModeChange("convert")}
          data-testid="button-mode-convert"
        >
          Convert
        </Button>
        <Button
          size="sm"
          variant={mode === "remittance" ? "default" : "outline"}
          onClick={() => handleModeChange("remittance")}
          data-testid="button-mode-remittance"
        >
          Remittance (HO)
        </Button>
      </div>

      {mode === "convert" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Two-way cash/bank exchange between operating stores. Store A sends cash, Store B sends equivalent bank transfer.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>From Store (Cash Out)</Label>
              <div className="flex gap-1 flex-wrap">
                {["Meat", "Trading"].map((name) => {
                  const store = activeStores.find((s) => s.name === name);
                  if (!store) return null;
                  return (
                    <Button
                      key={store.id}
                      size="sm"
                      variant={fromStoreId === store.id ? "default" : "outline"}
                      onClick={() => { setFromStoreId(store.id); if (store.id === toStoreId) setToStoreId(""); }}
                      data-testid={`button-quick-from-${name.toLowerCase()}`}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
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
              <div className="flex gap-1 flex-wrap">
                {["Sushi", "Sandwich", "Trading"].map((name) => {
                  const store = availableToStores.find((s) => s.name === name);
                  if (!store) return null;
                  return (
                    <Button
                      key={store.id}
                      size="sm"
                      variant={toStoreId === store.id ? "default" : "outline"}
                      onClick={() => setToStoreId(store.id)}
                      data-testid={`button-quick-to-${name.toLowerCase()}`}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
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
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            One-way cash transfer from operating store to HO. Cash only - no bank exchange.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>From Store</Label>
              <div className="flex gap-1 flex-wrap">
                {["Sushi", "Sandwich"].map((name) => {
                  const store = operatingStores.find((s) => s.name === name);
                  if (!store) return null;
                  return (
                    <Button
                      key={store.id}
                      size="sm"
                      variant={fromStoreId === store.id ? "default" : "outline"}
                      onClick={() => setFromStoreId(store.id)}
                      data-testid={`button-quick-remit-from-${name.toLowerCase()}`}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
              <Select value={fromStoreId} onValueChange={setFromStoreId}>
                <SelectTrigger data-testid="select-remit-from">
                  <SelectValue placeholder="Select store" />
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
              <div className="flex items-center h-9 px-3 rounded-md border bg-muted text-muted-foreground">
                HO
              </div>
            </div>
          </div>
        </>
      )}

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
          placeholder={mode === "convert" ? "e.g. [Temp Loan - Meat to reimburse tomorrow]" : "e.g. Weekly cash remittance"}
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
        {mutation.isPending ? "Processing..." : mode === "convert" ? "Record Convert" : "Record Remittance"}
      </Button>
    </div>
  );
}
