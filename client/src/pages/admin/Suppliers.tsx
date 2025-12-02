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

export function AdminSuppliers() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    active: true,
  });

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) {
        throw new Error("Supplier name is required");
      }
      const res = await apiRequest("POST", "/api/suppliers", form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setShowDialog(false);
      resetForm();
      toast({ title: "Supplier created" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to create supplier", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editSupplier) return;
      if (!form.name.trim()) {
        throw new Error("Supplier name is required");
      }
      const res = await apiRequest("PUT", `/api/suppliers/${editSupplier.id}`, form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setEditSupplier(null);
      resetForm();
      toast({ title: "Supplier updated" });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to update supplier", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({
      name: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
      active: true,
    });
  };

  const openEdit = (supplier: Supplier) => {
    setEditSupplier(supplier);
    setForm({
      name: supplier.name,
      contactName: supplier.contactName || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
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
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Supplier List</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate("/admin/suppliers/invoices")} data-testid="button-invoices">
                  <FileText className="w-4 h-4 mr-2" />
                  Invoices
                </Button>
                <Dialog open={showDialog} onOpenChange={setShowDialog}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-supplier">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Supplier
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Supplier</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          value={form.name}
                          onChange={(e) => setForm({...form, name: e.target.value})}
                          data-testid="input-supplier-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="contact">Contact Name</Label>
                        <Input
                          id="contact"
                          value={form.contactName}
                          onChange={(e) => setForm({...form, contactName: e.target.value})}
                          data-testid="input-contact-name"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input
                            id="email"
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({...form, email: e.target.value})}
                            data-testid="input-email"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="phone">Phone</Label>
                          <Input
                            id="phone"
                            value={form.phone}
                            onChange={(e) => setForm({...form, phone: e.target.value})}
                            data-testid="input-phone"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <Input
                          id="address"
                          value={form.address}
                          onChange={(e) => setForm({...form, address: e.target.value})}
                          data-testid="input-address"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                          id="notes"
                          value={form.notes}
                          onChange={(e) => setForm({...form, notes: e.target.value})}
                          data-testid="input-notes"
                        />
                      </div>
                      <Button 
                        onClick={() => createMutation.mutate()} 
                        disabled={!form.name || createMutation.isPending}
                        className="w-full"
                        data-testid="button-save-supplier"
                      >
                        Create Supplier
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!suppliers?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No suppliers yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map(supplier => (
                    <TableRow key={supplier.id} data-testid={`row-supplier-${supplier.id}`}>
                      <TableCell className="font-medium">{supplier.name}</TableCell>
                      <TableCell>{supplier.contactName || "-"}</TableCell>
                      <TableCell>{supplier.email || "-"}</TableCell>
                      <TableCell>{supplier.phone || "-"}</TableCell>
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

      <Dialog open={!!editSupplier} onOpenChange={() => { setEditSupplier(null); resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                data-testid="input-edit-supplier-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact">Contact Name</Label>
              <Input
                id="edit-contact"
                value={form.contactName}
                onChange={(e) => setForm({...form, contactName: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  value={form.phone}
                  onChange={(e) => setForm({...form, phone: e.target.value})}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">Address</Label>
              <Input
                id="edit-address"
                value={form.address}
                onChange={(e) => setForm({...form, address: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={form.notes}
                onChange={(e) => setForm({...form, notes: e.target.value})}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-active">Active</Label>
              <Switch
                id="edit-active"
                checked={form.active}
                onCheckedChange={(checked) => setForm({...form, active: checked})}
                data-testid="switch-active"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setEditSupplier(null); resetForm(); }}>Cancel</Button>
              <Button 
                onClick={() => updateMutation.mutate()} 
                disabled={!form.name || updateMutation.isPending}
                data-testid="button-update-supplier"
              >
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
