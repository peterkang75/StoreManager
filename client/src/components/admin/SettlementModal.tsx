import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Banknote, Building2 } from "lucide-react";

export interface EnrichedSettlement {
  id: string;
  payrollId: string;
  employeeId: string;
  employeeName: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  totalAmountDue: number;
  paidInCash: number;
  paidInBank: number;
  status: string;
  createdAt: string;
  settledAt: string | null;
}

interface Props {
  settlement: EnrichedSettlement | null;
  open: boolean;
  onClose: () => void;
}

function fmtAUD(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(n);
}

export function SettlementModal({ settlement, open, onClose }: Props) {
  const { toast } = useToast();
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");

  const remaining = settlement
    ? settlement.totalAmountDue - (parseFloat(cash) || 0) - (parseFloat(bank) || 0)
    : 0;

  const settleMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/settlements/${settlement!.id}/settle`, {
        paidInCash: parseFloat(cash) || 0,
        paidInBank: parseFloat(bank) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });
      toast({ title: "Settlement recorded", description: "Payment has been marked as settled." });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record settlement.", variant: "destructive" });
    },
  });

  function handleOpen(isOpen: boolean) {
    if (!isOpen) {
      setCash("");
      setBank("");
      onClose();
    }
  }

  if (!settlement) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md" data-testid="modal-settlement">
        <DialogHeader>
          <DialogTitle>Record Intercompany Settlement</DialogTitle>
          <DialogDescription>정산금액을 입력하고 내역을 기록하세요.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary row */}
          <div className="rounded-md border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{settlement.fromStoreName}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{settlement.toStoreName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Employee</span>
              <span className="text-sm font-medium" data-testid="text-settlement-employee">
                {settlement.employeeName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Amount Due</span>
              <span className="text-sm font-semibold text-foreground" data-testid="text-settlement-amount">
                {fmtAUD(settlement.totalAmountDue)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Remaining</span>
              <Badge
                className={remaining > 0.005 ? "bg-orange-500 text-white" : "bg-green-600 text-white"}
                data-testid="badge-settlement-remaining"
              >
                {fmtAUD(Math.max(0, remaining))}
              </Badge>
            </div>
          </div>

          {/* Payment fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="settlement-cash">Cash Paid</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="settlement-cash"
                  className="pl-6"
                  placeholder="0.00"
                  value={cash}
                  onChange={e => setCash(e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  data-testid="input-settlement-cash"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settlement-bank">Bank Transfer</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="settlement-bank"
                  className="pl-6"
                  placeholder="0.00"
                  value={bank}
                  onChange={e => setBank(e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  data-testid="input-settlement-bank"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Banknote className="h-3.5 w-3.5 shrink-0" />
            {settlement.fromStoreName}이 {settlement.toStoreName}에게 지급하는 금액입니다.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} data-testid="button-settlement-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => settleMutation.mutate()}
            disabled={settleMutation.isPending || (parseFloat(cash) || 0) + (parseFloat(bank) || 0) <= 0}
            data-testid="button-settlement-confirm"
          >
            {settleMutation.isPending ? "Saving…" : "Mark Settled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
