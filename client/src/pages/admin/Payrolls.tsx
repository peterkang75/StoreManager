import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { DollarSign, RefreshCw, Edit } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Payroll, Employee } from "@shared/schema";

export function AdminPayrolls() {
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [generateStart, setGenerateStart] = useState("");
  const [generateEnd, setGenerateEnd] = useState("");
  const [editPayroll, setEditPayroll] = useState<Payroll | null>(null);
  const [editForm, setEditForm] = useState({
    adjustment: 0,
    adjustmentReason: "",
    cashAmount: 0,
    bankDepositAmount: 0,
    taxAmount: 0,
    superAmount: 0,
    memo: "",
  });

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (periodStart) params.append("period_start", periodStart);
    if (periodEnd) params.append("period_end", periodEnd);
    return params.toString();
  };

  const { data: payrolls, isLoading } = useQuery<Payroll[]>({
    queryKey: ["/api/payrolls", periodStart, periodEnd],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/payrolls${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch payrolls");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!generateStart) throw new Error("Period start date is required");
      if (!generateEnd) throw new Error("Period end date is required");
      const res = await apiRequest("POST", "/api/payrolls/generate", {
        period_start: generateStart,
        period_end: generateEnd,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls"] });
      toast({ title: `Generated ${data.length} payroll record(s)` });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to generate payrolls", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editPayroll) return;
      const totalWithAdjustment = editPayroll.calculatedAmount + editForm.adjustment;
      const res = await apiRequest("PUT", `/api/payrolls/${editPayroll.id}`, {
        ...editForm,
        totalWithAdjustment,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payrolls"] });
      setEditPayroll(null);
      toast({ title: "Payroll updated" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to update payroll", variant: "destructive" });
    },
  });

  const getEmployeeName = (employeeId: string) => {
    const emp = employees?.find(e => e.id === employeeId);
    return emp ? `${emp.firstName} ${emp.lastName}` : "Unknown";
  };

  const openEdit = (payroll: Payroll) => {
    setEditPayroll(payroll);
    setEditForm({
      adjustment: payroll.adjustment,
      adjustmentReason: payroll.adjustmentReason || "",
      cashAmount: payroll.cashAmount,
      bankDepositAmount: payroll.bankDepositAmount,
      taxAmount: payroll.taxAmount,
      superAmount: payroll.superAmount,
      memo: payroll.memo || "",
    });
  };

  if (isLoading) {
    return (
      <AdminLayout title="Payroll">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Payroll">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate Payroll</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="gen-start">Period Start</Label>
                <Input
                  id="gen-start"
                  type="date"
                  value={generateStart}
                  onChange={(e) => setGenerateStart(e.target.value)}
                  data-testid="input-generate-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gen-end">Period End</Label>
                <Input
                  id="gen-end"
                  type="date"
                  value={generateEnd}
                  onChange={(e) => setGenerateEnd(e.target.value)}
                  data-testid="input-generate-end"
                />
              </div>
              <Button 
                onClick={() => generateMutation.mutate()}
                disabled={!generateStart || !generateEnd || generateMutation.isPending}
                data-testid="button-generate-payroll"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Generate from Approved Timesheets
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              This will create payroll records for all approved timesheets in the selected period.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Payroll Records</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="filter-start" className="text-sm whitespace-nowrap">From:</Label>
                  <Input
                    id="filter-start"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-40"
                    data-testid="input-filter-start"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="filter-end" className="text-sm whitespace-nowrap">To:</Label>
                  <Input
                    id="filter-end"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-40"
                    data-testid="input-filter-end"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!payrolls?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No payroll records found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Calculated</TableHead>
                      <TableHead className="text-right">Adjustment</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrolls.map(payroll => (
                      <TableRow key={payroll.id} data-testid={`row-payroll-${payroll.id}`}>
                        <TableCell className="font-medium">{getEmployeeName(payroll.employeeId)}</TableCell>
                        <TableCell>{payroll.periodStart} - {payroll.periodEnd}</TableCell>
                        <TableCell className="text-right">{payroll.hours.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${payroll.rate.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${payroll.calculatedAmount.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {payroll.adjustment !== 0 && (
                            <span className={payroll.adjustment > 0 ? "text-green-600" : "text-red-600"}>
                              {payroll.adjustment > 0 ? "+" : ""}${payroll.adjustment.toFixed(2)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">${payroll.totalWithAdjustment.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEdit(payroll)}
                            data-testid={`button-edit-${payroll.id}`}
                          >
                            <Edit className="w-4 h-4" />
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

      <Dialog open={!!editPayroll} onOpenChange={() => setEditPayroll(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Payroll</DialogTitle>
          </DialogHeader>
          {editPayroll && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm p-3 bg-muted rounded-lg">
                <div>
                  <span className="text-muted-foreground">Employee:</span>
                  <span className="ml-2 font-medium">{getEmployeeName(editPayroll.employeeId)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Calculated:</span>
                  <span className="ml-2 font-medium">${editPayroll.calculatedAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adjustment">Adjustment ($)</Label>
                  <Input
                    id="adjustment"
                    type="number"
                    step="0.01"
                    value={editForm.adjustment}
                    onChange={(e) => setEditForm({...editForm, adjustment: parseFloat(e.target.value) || 0})}
                    data-testid="input-adjustment"
                  />
                </div>
                <div className="space-y-2">
                  <Label>New Total</Label>
                  <div className="h-9 px-3 flex items-center bg-muted rounded-md font-medium">
                    ${(editPayroll.calculatedAmount + editForm.adjustment).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adjustment-reason">Adjustment Reason</Label>
                <Input
                  id="adjustment-reason"
                  value={editForm.adjustmentReason}
                  onChange={(e) => setEditForm({...editForm, adjustmentReason: e.target.value})}
                  placeholder="e.g., Bonus, Deduction, etc."
                  data-testid="input-adjustment-reason"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cash">Cash Amount ($)</Label>
                  <Input
                    id="cash"
                    type="number"
                    step="0.01"
                    value={editForm.cashAmount}
                    onChange={(e) => setEditForm({...editForm, cashAmount: parseFloat(e.target.value) || 0})}
                    data-testid="input-cash"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank">Bank Deposit ($)</Label>
                  <Input
                    id="bank"
                    type="number"
                    step="0.01"
                    value={editForm.bankDepositAmount}
                    onChange={(e) => setEditForm({...editForm, bankDepositAmount: parseFloat(e.target.value) || 0})}
                    data-testid="input-bank"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tax">Tax Amount ($)</Label>
                  <Input
                    id="tax"
                    type="number"
                    step="0.01"
                    value={editForm.taxAmount}
                    onChange={(e) => setEditForm({...editForm, taxAmount: parseFloat(e.target.value) || 0})}
                    data-testid="input-tax"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="super">Super Amount ($)</Label>
                  <Input
                    id="super"
                    type="number"
                    step="0.01"
                    value={editForm.superAmount}
                    onChange={(e) => setEditForm({...editForm, superAmount: parseFloat(e.target.value) || 0})}
                    data-testid="input-super"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="memo">Memo</Label>
                <Textarea
                  id="memo"
                  value={editForm.memo}
                  onChange={(e) => setEditForm({...editForm, memo: e.target.value})}
                  placeholder="Additional notes..."
                  data-testid="input-memo"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditPayroll(null)}>Cancel</Button>
                <Button 
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-payroll"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
