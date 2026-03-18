import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Clock, FileText, DollarSign, Receipt } from "lucide-react";
import type { SupplierInvoice, Supplier } from "@shared/schema";

type EnrichedInvoice = SupplierInvoice & { supplier: Supplier | null };

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  OVERDUE: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  QUARANTINE: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function fmtAUD(amount: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

function isDueSoon(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 7;
}

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

export function AdminAccountsPayable() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");

  const { data: invoices = [], isLoading } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", statusFilter, supplierFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (supplierFilter !== "ALL") params.set("supplierId", supplierFilter);
      const res = await fetch(`/api/invoices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
  });

  // All invoices (unfiltered) for summary metrics — always show totals for ALL PENDING
  const { data: allPending = [] } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", "PENDING", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/invoices?status=PENDING");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const markPaidMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/invoices/${id}/status`, { status: "PAID" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice marked as paid" });
    },
    onError: () => toast({ title: "Failed to update invoice", variant: "destructive" }),
  });

  const totalPayable = allPending.reduce((sum, inv) => sum + (inv.amount ?? 0), 0);
  const pendingCount = allPending.length;

  // Unique suppliers list for filter dropdown
  const uniqueSuppliers = suppliers.filter(s => s.active);

  return (
    <AdminLayout title="Accounts Payable">
      {/* ── Summary Cards ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Payable (Pending)
              </CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className="text-3xl font-bold tracking-tight"
                data-testid="text-total-payable"
              >
                {fmtAUD(totalPayable)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all pending invoices
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending Invoices
              </CardTitle>
              <Receipt className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className="text-3xl font-bold tracking-tight"
                data-testid="text-pending-count"
              >
                {pendingCount}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Awaiting payment
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Status</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Supplier</span>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-48" data-testid="select-supplier-filter">
                <SelectValue placeholder="All Suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Suppliers</SelectItem>
                {uniqueSuppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="text-sm text-muted-foreground ml-auto">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Invoice Table ──────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Loading invoices...
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
                <FileText className="w-8 h-8 opacity-30" />
                <span className="text-sm">No invoices found</span>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => {
                    const overdue = isOverdue(inv.dueDate);
                    const dueSoon = isDueSoon(inv.dueDate);
                    const isPending = inv.status === "PENDING";
                    const isMarking = markPaidMutation.isPending && markPaidMutation.variables === inv.id;

                    return (
                      <TableRow
                        key={inv.id}
                        data-testid={`row-invoice-${inv.id}`}
                        className={overdue && isPending ? "bg-red-50/50 dark:bg-red-950/20" : ""}
                      >
                        <TableCell className="font-medium">
                          {inv.supplier?.name ?? (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                        </TableCell>

                        <TableCell className="font-mono text-sm">
                          {inv.invoiceNumber || "—"}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {fmt(inv.invoiceDate)}
                        </TableCell>

                        <TableCell className="text-sm">
                          {inv.dueDate ? (
                            <span className={
                              overdue && isPending
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : dueSoon && isPending
                                  ? "text-orange-600 dark:text-orange-400 font-medium"
                                  : "text-muted-foreground"
                            }>
                              {overdue && isPending && (
                                <AlertCircle className="inline w-3 h-3 mr-1 mb-0.5" />
                              )}
                              {dueSoon && !overdue && isPending && (
                                <Clock className="inline w-3 h-3 mr-1 mb-0.5" />
                              )}
                              {fmt(inv.dueDate)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtAUD(inv.amount ?? 0)}
                        </TableCell>

                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? STATUS_COLORS.PENDING}`}
                            data-testid={`status-invoice-${inv.id}`}
                          >
                            {inv.status}
                          </span>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {inv.notes && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title={inv.notes}
                                data-testid={`button-notes-${inv.id}`}
                              >
                                <FileText className="w-4 h-4" />
                              </Button>
                            )}

                            {isPending && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-markpaid-${inv.id}`}
                                    disabled={isMarking}
                                  >
                                    <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                                    Mark Paid
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Mark Invoice as Paid</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Mark invoice <strong>{inv.invoiceNumber}</strong> from{" "}
                                      <strong>{inv.supplier?.name ?? "unknown supplier"}</strong>{" "}
                                      ({fmtAUD(inv.amount ?? 0)}) as paid? This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => markPaidMutation.mutate(inv.id)}
                                      data-testid={`button-confirm-paid-${inv.id}`}
                                    >
                                      Confirm Paid
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
