import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Plus, Truck, Edit, FileText } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";

type FormState = {
  name: string;
  contactName: string;
  abn: string;
  contactEmails: string;
  bsb: string;
  accountNumber: string;
  address: string;
  notes: string;
  active: boolean;
};

const BLANK_FORM: FormState = {
  name: "",
  contactName: "",
  abn: "",
  contactEmails: "",
  bsb: "",
  accountNumber: "",
  address: "",
  notes: "",
  active: true,
};

function parseEmails(raw: string): string[] {
  return raw
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0);
}

function emailsToString(arr: string[] | null | undefined): string {
  return (arr ?? []).join(", ");
}

function SupplierForm({
  form,
  setForm,
  isEdit,
  isPending,
  onSubmit,
  onCancel,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  isEdit: boolean;
  isPending: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="sup-name">Name *</Label>
        <Input
          id="sup-name"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Sydney Fish Market"
          data-testid="input-supplier-name"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sup-abn">ABN</Label>
          <Input
            id="sup-abn"
            value={form.abn}
            onChange={e => setForm({ ...form, abn: e.target.value })}
            placeholder="12 345 678 901"
            data-testid="input-abn"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sup-contact">Contact Name</Label>
          <Input
            id="sup-contact"
            value={form.contactName}
            onChange={e => setForm({ ...form, contactName: e.target.value })}
            data-testid="input-contact-name"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sup-emails">Whitelisted Emails</Label>
        <Input
          id="sup-emails"
          value={form.contactEmails}
          onChange={e => setForm({ ...form, contactEmails: e.target.value })}
          placeholder="billing@supplier.com, accounts@supplier.com"
          data-testid="input-contact-emails"
        />
        <p className="text-xs text-muted-foreground">
          Invoices sent from these email addresses will be automatically accepted and parsed by the AI.
          Separate multiple addresses with commas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sup-bsb">BSB</Label>
          <Input
            id="sup-bsb"
            value={form.bsb}
            onChange={e => setForm({ ...form, bsb: e.target.value })}
            placeholder="000-000"
            data-testid="input-bsb"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sup-acct">Account Number</Label>
          <Input
            id="sup-acct"
            value={form.accountNumber}
            onChange={e => setForm({ ...form, accountNumber: e.target.value })}
            placeholder="123456789"
            data-testid="input-account-number"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sup-address">Address</Label>
        <Input
          id="sup-address"
          value={form.address}
          onChange={e => setForm({ ...form, address: e.target.value })}
          data-testid="input-address"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sup-notes">Notes</Label>
        <Textarea
          id="sup-notes"
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          data-testid="input-notes"
        />
      </div>

      {isEdit && (
        <div className="flex items-center justify-between pt-1">
          <Label htmlFor="sup-active">Active</Label>
          <Switch
            id="sup-active"
            checked={form.active}
            onCheckedChange={checked => setForm({ ...form, active: checked })}
            data-testid="switch-active"
          />
        </div>
      )}

      <div className={`flex gap-2 pt-1 ${isEdit ? "justify-end" : ""}`}>
        {isEdit && (
          <Button variant="outline" onClick={onCancel} type="button">
            Cancel
          </Button>
        )}
        <Button
          onClick={onSubmit}
          disabled={!form.name.trim() || isPending}
          className={isEdit ? "" : "w-full"}
          data-testid={isEdit ? "button-update-supplier" : "button-save-supplier"}
        >
          {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Supplier"}
        </Button>
      </div>
    </div>
  );
}

export function AdminSuppliers() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  function buildPayload(f: FormState) {
    return {
      name: f.name.trim(),
      contactName: f.contactName.trim() || null,
      abn: f.abn.trim() || null,
      contactEmails: parseEmails(f.contactEmails),
      bsb: f.bsb.trim() || null,
      accountNumber: f.accountNumber.trim() || null,
      address: f.address.trim() || null,
      notes: f.notes.trim() || null,
      active: f.active,
    };
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Supplier name is required");
      const res = await apiRequest("POST", "/api/suppliers", buildPayload(form));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setShowDialog(false);
      setForm(BLANK_FORM);
      toast({ title: "Supplier created" });
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Failed to create supplier", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editSupplier) return;
      if (!form.name.trim()) throw new Error("Supplier name is required");
      const res = await apiRequest("PUT", `/api/suppliers/${editSupplier.id}`, buildPayload(form));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setEditSupplier(null);
      setForm(BLANK_FORM);
      toast({ title: "Supplier updated" });
    },
    onError: (err: Error) => {
      toast({ title: err.message || "Failed to update supplier", variant: "destructive" });
    },
  });

  const openEdit = (supplier: Supplier) => {
    setEditSupplier(supplier);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName || "",
      abn: supplier.abn || "",
      contactEmails: emailsToString(supplier.contactEmails),
      bsb: supplier.bsb || "",
      accountNumber: supplier.accountNumber || "",
      address: supplier.address || "",
      notes: supplier.notes || "",
      active: supplier.active,
    });
  };

  if (isLoading) {
    return (
      <AdminLayout title="Suppliers">
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Suppliers">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Supplier List</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate("/admin/suppliers/invoices")}
                  data-testid="button-invoices"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Invoices
                </Button>

                <Dialog
                  open={showDialog}
                  onOpenChange={open => {
                    setShowDialog(open);
                    if (!open) setForm(BLANK_FORM);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-supplier">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Supplier
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add Supplier</DialogTitle>
                    </DialogHeader>
                    <SupplierForm
                      form={form}
                      setForm={setForm}
                      isEdit={false}
                      isPending={createMutation.isPending}
                      onSubmit={() => createMutation.mutate()}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {!suppliers?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>등록된 거래처가 없습니다</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>ABN</TableHead>
                    <TableHead>Whitelisted Emails</TableHead>
                    <TableHead>Banking Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map(supplier => (
                    <TableRow key={supplier.id} data-testid={`row-supplier-${supplier.id}`}>
                      <TableCell>
                        <div className="font-medium">{supplier.name}</div>
                        {supplier.contactName && (
                          <div className="text-xs text-muted-foreground">{supplier.contactName}</div>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground font-mono">
                        {supplier.abn || "—"}
                      </TableCell>

                      <TableCell>
                        {supplier.contactEmails && supplier.contactEmails.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {supplier.contactEmails.map(email => (
                              <span
                                key={email}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground border border-border"
                                data-testid={`tag-email-${supplier.id}`}
                              >
                                {email}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-sm">
                        {supplier.bsb || supplier.accountNumber ? (
                          <div className="space-y-0.5">
                            {supplier.bsb && (
                              <div className="font-mono text-xs text-muted-foreground">
                                BSB: {supplier.bsb}
                              </div>
                            )}
                            {supplier.accountNumber && (
                              <div className="font-mono text-xs">
                                Acct: {supplier.accountNumber}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {supplier.active ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(supplier)}
                          data-testid={`button-edit-${supplier.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Edit Supplier Dialog ─────────────────────────────── */}
      <Dialog
        open={!!editSupplier}
        onOpenChange={open => {
          if (!open) {
            setEditSupplier(null);
            setForm(BLANK_FORM);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
          </DialogHeader>
          <SupplierForm
            form={form}
            setForm={setForm}
            isEdit={true}
            isPending={updateMutation.isPending}
            onSubmit={() => updateMutation.mutate()}
            onCancel={() => {
              setEditSupplier(null);
              setForm(BLANK_FORM);
            }}
          />
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
