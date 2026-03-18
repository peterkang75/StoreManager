import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Clock, FileText, DollarSign, Receipt } from "lucide-react";
import type { SupplierInvoice, Supplier, Store } from "@shared/schema";

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

function isDueSoon(dueDate: string | null | undefined, isPending: boolean): boolean {
  if (!dueDate || !isPending) return false;
  const diff = (new Date(dueDate).getTime() - Date.now()) / 86400000;
  return diff >= 0 && diff <= 7;
}

function isOverdue(dueDate: string | null | undefined, isPending: boolean): boolean {
  if (!dueDate || !isPending) return false;
  return new Date(dueDate) < new Date();
}

export function AdminAccountsPayable() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [storeFilter, setStoreFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: invoices = [], isLoading } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", statusFilter, supplierFilter, storeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (supplierFilter !== "ALL") params.set("supplierId", supplierFilter);
      if (storeFilter !== "ALL") params.set("storeId", storeFilter);
      const res = await fetch(`/api/invoices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch invoices");
      return res.json();
    },
  });

  const { data: allPending = [] } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices", "PENDING", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/invoices?status=PENDING");
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map(id => apiRequest("PATCH", `/api/invoices/${id}/status`, { status: "PAID" }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setSelected(new Set());
      toast({ title: `${selected.size} invoice${selected.size !== 1 ? "s" : ""} marked as paid` });
    },
    onError: () => toast({ title: "Failed to update invoices", variant: "destructive" }),
  });

  const totalPayable = allPending.reduce((sum, inv) => sum + (inv.amount ?? 0), 0);
  const pendingCount = allPending.length;

  const selectedTotal = useMemo(() => {
    return invoices
      .filter(inv => selected.has(inv.id))
      .reduce((sum, inv) => sum + (inv.amount ?? 0), 0);
  }, [invoices, selected]);

  const pendingInvoices = invoices.filter(inv => inv.status === "PENDING");
  const allPendingSelected =
    pendingInvoices.length > 0 && pendingInvoices.every(inv => selected.has(inv.id));
  const somePendingSelected = pendingInvoices.some(inv => selected.has(inv.id));

  function toggleAll() {
    if (allPendingSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingInvoices.map(inv => inv.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeStores = stores.filter(s => s.active && !s.isExternal);

  return (
    <AdminLayout title="Accounts Payable">
      <div className="flex flex-col gap-6">

        {/* ── Summary Cards ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Payable (Pending)
              </CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight" data-testid="text-total-payable">
                {fmtAUD(totalPayable)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across all pending invoices</p>
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
              <div className="text-3xl font-bold tracking-tight" data-testid="text-pending-count">
                {pendingCount}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Awaiting payment</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Filters + Bulk Actions ──────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Status</span>
            <Select
              value={statusFilter}
              onValueChange={v => { setStatusFilter(v); setSelected(new Set()); }}
            >
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
            <Select
              value={supplierFilter}
              onValueChange={v => { setSupplierFilter(v); setSelected(new Set()); }}
            >
              <SelectTrigger className="w-44" data-testid="select-supplier-filter">
                <SelectValue placeholder="All Suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Suppliers</SelectItem>
                {suppliers.filter(s => s.active).map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Store</span>
            <Select
              value={storeFilter}
              onValueChange={v => { setStoreFilter(v); setSelected(new Set()); }}
            >
              <SelectTrigger className="w-36" data-testid="select-store-filter">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Stores</SelectItem>
                {activeStores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="text-sm text-muted-foreground">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          </span>

          {/* Selected total + Bulk action */}
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm font-medium tabular-nums" data-testid="text-selected-total">
                {fmtAUD(selectedTotal)} selected ({selected.size})
              </span>
              <Button
                onClick={() => bulkMarkPaidMutation.mutate(Array.from(selected))}
                disabled={bulkMarkPaidMutation.isPending}
                data-testid="button-bulk-mark-paid"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {bulkMarkPaidMutation.isPending
                  ? "Updating..."
                  : `Mark ${selected.size} as Paid`}
              </Button>
            </div>
          )}
        </div>

        {/* ── Invoice Table ───────────────────────────────────────────── */}
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
                    <TableHead className="w-10 pl-4">
                      {pendingInvoices.length > 0 && (
                        <Checkbox
                          checked={allPendingSelected}
                          data-state={somePendingSelected && !allPendingSelected ? "indeterminate" : undefined}
                          onCheckedChange={toggleAll}
                          aria-label="Select all pending"
                          data-testid="checkbox-select-all"
                        />
                      )}
                    </TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => {
                    const isPending = inv.status === "PENDING";
                    const overdue = isOverdue(inv.dueDate, isPending);
                    const dueSoon = isDueSoon(inv.dueDate, isPending);
                    const isChecked = selected.has(inv.id);
                    const store = stores.find(s => s.id === inv.storeId);

                    return (
                      <TableRow
                        key={inv.id}
                        data-testid={`row-invoice-${inv.id}`}
                        className={[
                          overdue ? "bg-red-50/50 dark:bg-red-950/20" : "",
                          isChecked ? "bg-muted/40" : "",
                        ].join(" ")}
                      >
                        <TableCell className="pl-4">
                          {isPending && (
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleOne(inv.id)}
                              aria-label={`Select invoice ${inv.invoiceNumber}`}
                              data-testid={`checkbox-invoice-${inv.id}`}
                            />
                          )}
                        </TableCell>

                        <TableCell className="font-medium">
                          {inv.supplier?.name ?? (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                        </TableCell>

                        <TableCell className="font-mono text-sm">
                          {inv.invoiceNumber || "—"}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {store?.name ?? "—"}
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {fmt(inv.invoiceDate)}
                        </TableCell>

                        <TableCell className="text-sm">
                          {inv.dueDate ? (
                            <span className={
                              overdue
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : dueSoon
                                  ? "text-orange-600 dark:text-orange-400 font-medium"
                                  : "text-muted-foreground"
                            }>
                              {overdue && <AlertCircle className="inline w-3 h-3 mr-1 mb-0.5" />}
                              {dueSoon && !overdue && <Clock className="inline w-3 h-3 mr-1 mb-0.5" />}
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

                        <TableCell>
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
