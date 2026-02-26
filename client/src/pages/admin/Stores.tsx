import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Store as StoreIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, InsertStore } from "@shared/schema";

function StoreForm({
  store,
  onSave,
  onCancel,
  isPending,
}: {
  store?: Store;
  onSave: (data: InsertStore) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState<InsertStore>({
    name: store?.name ?? "",
    code: store?.code ?? "",
    address: store?.address ?? "",
    active: store?.active ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">매장 이름 *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="매장 이름 입력"
            required
            data-testid="input-store-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">매장 코드 *</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            placeholder="예: SYD01"
            required
            data-testid="input-store-code"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">주소</Label>
        <Input
          id="address"
          value={formData.address ?? ""}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          placeholder="매장 주소 입력"
          data-testid="input-store-address"
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id="active"
          checked={formData.active}
          onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
          data-testid="switch-store-active"
        />
        <Label htmlFor="active">매장 활성화</Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel">
          취소
        </Button>
        <Button type="submit" disabled={isPending} data-testid="button-save-store">
          {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {store ? "매장 업데이트" : "매장 생성"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AdminStores() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | undefined>();

  const { data: stores, isLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertStore) => {
      const res = await apiRequest("POST", "/api/stores", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      setDialogOpen(false);
      toast({ title: "매장이 생성되었습니다" });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertStore> }) => {
      const res = await apiRequest("PUT", `/api/stores/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      setDialogOpen(false);
      setEditingStore(undefined);
      toast({ title: "매장이 업데이트되었습니다" });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (data: InsertStore) => {
    if (editingStore) {
      updateMutation.mutate({ id: editingStore.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleOpenDialog = (store?: Store) => {
    setEditingStore(store);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingStore(undefined);
  };

  const toggleActive = (store: Store) => {
    updateMutation.mutate({ id: store.id, data: { active: !store.active } });
  };

  return (
    <AdminLayout title="Store Management">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Stores</h2>
            <p className="text-sm text-muted-foreground">
              Manage your store locations
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()} data-testid="button-add-store">
            <Plus className="w-4 h-4 mr-2" />
            Add Store
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : stores?.length === 0 ? (
              <div className="p-12 text-center">
                <StoreIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No stores yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Get started by adding your first store location.
                </p>
                <Button onClick={() => handleOpenDialog()} data-testid="button-add-first-store">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Store
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stores?.map((store) => (
                    <TableRow key={store.id} data-testid={`row-store-${store.id}`}>
                      <TableCell className="font-medium">{store.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {store.address || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={store.active}
                            onCheckedChange={() => toggleActive(store)}
                            data-testid={`switch-active-${store.id}`}
                          />
                          <span className={store.active ? "text-green-600" : "text-muted-foreground"}>
                            {store.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(store)}
                          data-testid={`button-edit-${store.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingStore ? "Edit Store" : "Add New Store"}
              </DialogTitle>
              <DialogDescription>
                {editingStore
                  ? "Update the store details below."
                  : "Enter the details for the new store."}
              </DialogDescription>
            </DialogHeader>
            <StoreForm
              store={editingStore}
              onSave={handleSave}
              onCancel={handleCloseDialog}
              isPending={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
