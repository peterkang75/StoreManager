import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
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
import { Plus, FileText, DollarSign } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, Supplier, SupplierInvoice, SupplierPayment } from "@shared/schema";

function getStatusBadge(status: string) {
  switch (status) {
    case "PAID":
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid</Badge>;
    case "PARTIAL":
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Partial</Badge>;
    default:
      return <Badge variant="destructive">Unpaid</Badge>;
  }
}

export function AdminSupplierInvoices() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SupplierInvoice | null>(null);
  
  const [invoiceForm, setInvoiceForm] = useState({
    supplierId: "",
    storeId: "",
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
    amount: 0,
    notes: "",
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    paymentDate: new Date().toISOString().split("T")[0],
    method: "bank",
    notes: "",
  });

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.append("status", statusFilter);
    if (supplierFilter !== "all") params.append("supplier_id", supplierFilter);
    return params.toString();
  };

  const { data: invoices, isLoading } = useQuery<SupplierInvoice[]>({
    queryKey: ["/api/supplier-invoices", statusFilter, supplierFilter],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/supplier-invoices${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: payments } = useQuery<SupplierPayment[]>({
    queryKey: ["/api/supplier-payments", selectedInvoice?.id],
    enabled: !!selectedInvoice,
    queryFn: async () => {
      if (!selectedInvoice) return [];
      const res = await fetch(`/api/supplier-payments?invoice_id=${selectedInvoice.id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceForm.supplierId) throw new Error("Supplier is required");
      if (!invoiceForm.invoiceNumber.trim()) throw new Error("Invoice number is required");
      if (!invoiceForm.invoiceDate) throw new Error("Invoice date is required");
      if (invoiceForm.amount <= 0) throw new Error("Amount must be greater than 0");
      const res = await apiRequest("POST", "/api/supplier-invoices", {
        ...invoiceForm,
        storeId: invoiceForm.storeId === "none" ? null : (invoiceForm.storeId || null),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      setShowInvoiceDialog(false);
      setInvoiceForm({
        supplierId: "",
        storeId: "",
        invoiceNumber: "",
        invoiceDate: "",
        dueDate: "",
        amount: 0,
        notes: "",
      });
      toast({ title: "Invoice created" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to create invoice", variant: "destructive" });
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice) return;
      if (paymentForm.amount <= 0) throw new Error("Payment amount must be greater than 0");
      if (!paymentForm.paymentDate) throw new Error("Payment date is required");
      const res = await apiRequest("POST", "/api/supplier-payments", {
        supplierId: selectedInvoice.supplierId,
        invoiceId: selectedInvoice.id,
        ...paymentForm,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-payments"] });
      setShowPaymentDialog(false);
      setPaymentForm({
        amount: 0,
        paymentDate: new Date().toISOString().split("T")[0],
        method: "bank",
        notes: "",
      });
      toast({ title: "Payment recorded" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to record payment", variant: "destructive" });
    },
  });

  const getSupplierName = (supplierId: string) => {
    return suppliers?.find(s => s.id === supplierId)?.name || "-";
  };

  const getStoreName = (storeId: string | null) => {
    if (!storeId) return "-";
    return stores?.find(s => s.id === storeId)?.name || "-";
  };

  const getTotalPaid = () => {
    return payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
  };

  if (isLoading) {
    return (
      <AdminLayout title="Supplier Invoices">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Supplier Invoices">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Invoices</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="UNPAID">Unpaid</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="PAID">Paid</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger className="w-40" data-testid="select-supplier-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers?.filter(s => s.active).map(supplier => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-invoice">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Invoice
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Invoice</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Supplier *</Label>
                        <Select value={invoiceForm.supplierId} onValueChange={(v) => setInvoiceForm({...invoiceForm, supplierId: v})}>
                          <SelectTrigger data-testid="select-invoice-supplier">
                            <SelectValue placeholder="Select supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers?.filter(s => s.active).map(supplier => (
                              <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Store (optional)</Label>
                        <Select value={invoiceForm.storeId} onValueChange={(v) => setInvoiceForm({...invoiceForm, storeId: v})}>
                          <SelectTrigger data-testid="select-invoice-store">
                            <SelectValue placeholder="Select store" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No store</SelectItem>
                            {stores?.filter(s => s.active).map(store => (
                              <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invoice-number">Invoice Number *</Label>
                        <Input
                          id="invoice-number"
                          value={invoiceForm.invoiceNumber}
                          onChange={(e) => setInvoiceForm({...invoiceForm, invoiceNumber: e.target.value})}
                          data-testid="input-invoice-number"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="invoice-date">Invoice Date *</Label>
                          <Input
                            id="invoice-date"
                            type="date"
                            value={invoiceForm.invoiceDate}
                            onChange={(e) => setInvoiceForm({...invoiceForm, invoiceDate: e.target.value})}
                            data-testid="input-invoice-date"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="due-date">Due Date</Label>
                          <Input
                            id="due-date"
                            type="date"
                            value={invoiceForm.dueDate}
                            onChange={(e) => setInvoiceForm({...invoiceForm, dueDate: e.target.value})}
                            data-testid="input-due-date"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="amount">Amount *</Label>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          value={invoiceForm.amount}
                          onChange={(e) => setInvoiceForm({...invoiceForm, amount: parseFloat(e.target.value) || 0})}
                          data-testid="input-amount"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                          id="notes"
                          value={invoiceForm.notes}
                          onChange={(e) => setInvoiceForm({...invoiceForm, notes: e.target.value})}
                          data-testid="input-notes"
                        />
                      </div>
                      <Button 
                        onClick={() => createInvoiceMutation.mutate()} 
                        disabled={!invoiceForm.supplierId || !invoiceForm.invoiceNumber || !invoiceForm.invoiceDate || createInvoiceMutation.isPending}
                        className="w-full"
                        data-testid="button-save-invoice"
                      >
                        Create Invoice
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!invoices?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>청구서가 없습니다</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(invoice => (
                    <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                      <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{getSupplierName(invoice.supplierId)}</TableCell>
                      <TableCell>{getStoreName(invoice.storeId)}</TableCell>
                      <TableCell>{invoice.invoiceDate}</TableCell>
                      <TableCell>{invoice.dueDate || "-"}</TableCell>
                      <TableCell className="text-right">${invoice.amount.toFixed(2)}</TableCell>
                      <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                      <TableCell className="text-right">
                        {invoice.status !== "PAID" && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                              setSelectedInvoice(invoice);
                              setPaymentForm({
                                ...paymentForm,
                                amount: invoice.amount - getTotalPaid(),
                              });
                              setShowPaymentDialog(true);
                            }}
                            data-testid={`button-pay-${invoice.id}`}
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Pay
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice:</span>
                  <span className="font-medium">{selectedInvoice.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Amount:</span>
                  <span className="font-medium">${selectedInvoice.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already Paid:</span>
                  <span className="font-medium">${getTotalPaid().toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="text-muted-foreground">Remaining:</span>
                  <span className="font-medium">${(selectedInvoice.amount - getTotalPaid()).toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-amount">Payment Amount *</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({...paymentForm, amount: parseFloat(e.target.value) || 0})}
                  data-testid="input-payment-amount"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payment-date">Payment Date *</Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm({...paymentForm, paymentDate: e.target.value})}
                    data-testid="input-payment-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Method</Label>
                  <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({...paymentForm, method: v})}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment-notes">Notes</Label>
                <Textarea
                  id="payment-notes"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({...paymentForm, notes: e.target.value})}
                  data-testid="input-payment-notes"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
                <Button 
                  onClick={() => createPaymentMutation.mutate()} 
                  disabled={!paymentForm.amount || !paymentForm.paymentDate || createPaymentMutation.isPending}
                  data-testid="button-record-payment"
                >
                  Record Payment
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
