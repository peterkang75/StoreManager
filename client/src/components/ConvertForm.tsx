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

export function ConvertForm({ stores }: { stores: Store[] }) {
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
