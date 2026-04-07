import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Package, RefreshCw, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import type { Store, StorageItem, StorageUnit } from "@shared/schema";

const STORAGE_CATEGORIES = [
  "Dry Goods", "Refrigerated", "Frozen", "Produce", "Beverages",
  "Sauces & Condiments", "Packaging", "Cleaning", "Other",
];

const ALL_STORES = "__all__";

export default function StorageInventory() {
  const { toast } = useToast();
  const [selectedStoreId, setSelectedStoreId] = useState<string>(ALL_STORES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<StorageItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formUnit, setFormUnit] = useState<string>("ea");
  const [formStoreId, setFormStoreId] = useState<string>(ALL_STORES);

  // Manage Units state
  const [manageUnitsOpen, setManageUnitsOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  const unitsQK = ["/api/storage/units"];
  const { data: units = [] } = useQuery<StorageUnit[]>({ queryKey: unitsQK });

  const storageQK = ["/api/storage/items", selectedStoreId];
  const { data: items = [], isLoading } = useQuery<StorageItem[]>({
    queryKey: storageQK,
    queryFn: async () => {
      const p = selectedStoreId !== ALL_STORES ? `?storeId=${selectedStoreId}` : "";
      const res = await fetch(`/api/storage/items${p}`);
      return res.ok ? res.json() : [];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/storage/items"] });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; category: string; unit: string; storeId: string | null }) =>
      apiRequest("POST", "/api/storage/items", data),
    onSuccess: () => { invalidate(); closeDialog(); toast({ title: "Item created" }); },
    onError: () => toast({ title: "Failed to create item", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<StorageItem> }) =>
      apiRequest("PATCH", `/api/storage/items/${id}`, data),
    onSuccess: () => { invalidate(); closeDialog(); toast({ title: "Item updated" }); },
    onError: () => toast({ title: "Failed to update item", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/storage/items/${id}`),
    onSuccess: () => { invalidate(); setDeleteConfirmId(null); toast({ title: "Item deleted" }); },
    onError: () => toast({ title: "Failed to delete item", variant: "destructive" }),
  });

  const createUnitMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/storage/units", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: unitsQK });
      setNewUnitName("");
      toast({ title: "Unit added" });
    },
    onError: () => toast({ title: "Unit already exists or failed to add", variant: "destructive" }),
  });

  const deleteUnitMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/storage/units/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: unitsQK });
      toast({ title: "Unit deleted" });
    },
    onError: () => toast({ title: "Unit is in use — remove it from all items first", variant: "destructive" }),
  });

  const usedUnitNames = new Set(items.map(i => i.unit).filter(Boolean));

  function openCreate() {
    setEditItem(null);
    setFormName("");
    setFormCategory("");
    setFormUnit("ea");
    setFormStoreId(selectedStoreId !== ALL_STORES ? selectedStoreId : ALL_STORES);
    setDialogOpen(true);
  }

  function openEdit(item: StorageItem) {
    setEditItem(item);
    setFormName(item.name);
    setFormCategory(item.category);
    setFormUnit(item.unit ?? "ea");
    setFormStoreId(item.storeId ?? ALL_STORES);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditItem(null);
  }

  function handleSave() {
    const payload = {
      name: formName.trim(),
      category: formCategory,
      unit: formUnit || "ea",
      storeId: formStoreId !== ALL_STORES ? formStoreId : null,
    };
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const grouped = items.reduce<Record<string, StorageItem[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  function fmtDate(d: Date | string | null | undefined) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function fmtStock(item: StorageItem) {
    const unit = item.unit ?? "ea";
    if (item.currentStock === null || item.currentStock === undefined) return null;
    if (item.currentStock === 0) return { label: "Out of Stock", color: "destructive" as const };
    if (item.currentStock <= 3) return { label: `Low (${item.currentStock} ${unit})`, color: "warning" as const };
    return { label: `${item.currentStock} ${unit}`, color: "normal" as const };
  }

  function getStoreName(id: string | null | undefined) {
    if (!id) return "All Stores";
    return stores.find(s => s.id === id)?.name ?? id;
  }

  return (
    <AdminLayout title="Storage">
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Storage Inventory</h1>
            <p className="text-sm text-muted-foreground">재고 목록 관리 및 현황 조회</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger className="w-44" data-testid="select-storage-store">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STORES}>All Stores</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => setManageUnitsOpen(o => !o)}
              data-testid="button-manage-units"
            >
              <Settings2 className="h-4 w-4 mr-1.5" />
              Manage Units
              {manageUnitsOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1.5" /> : <ChevronDown className="h-3.5 w-3.5 ml-1.5" />}
            </Button>
            <Button onClick={openCreate} data-testid="button-add-storage-item">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Item
            </Button>
          </div>
        </div>

        {/* Manage Units collapsible card */}
        {manageUnitsOpen && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Manage Units
                <span className="text-xs font-normal text-muted-foreground">단위 관리</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                {units.map(u => {
                  const inUse = usedUnitNames.has(u.name);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
                      data-testid={`unit-chip-${u.id}`}
                    >
                      <span className="font-medium">{u.name}</span>
                      {inUse && (
                        <span className="text-xs text-muted-foreground">(in use)</span>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={deleteUnitMutation.isPending}
                        onClick={() => deleteUnitMutation.mutate(u.id)}
                        data-testid={`button-delete-unit-${u.id}`}
                        title={inUse ? "Remove from all items first" : "Delete unit"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="New unit name…"
                  value={newUnitName}
                  onChange={e => setNewUnitName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newUnitName.trim()) createUnitMutation.mutate(newUnitName.trim()); }}
                  className="max-w-48"
                  data-testid="input-new-unit-name"
                />
                <Button
                  disabled={!newUnitName.trim() || createUnitMutation.isPending}
                  onClick={() => createUnitMutation.mutate(newUnitName.trim())}
                  data-testid="button-add-unit"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Unit
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-muted-foreground">No storage items yet</p>
              <p className="text-sm text-muted-foreground mt-1">아이템을 추가하세요.</p>
            </CardContent>
          </Card>
        )}

        {categories.map(cat => (
          <Card key={cat}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Badge variant="secondary">{cat}</Badge>
                <span className="text-muted-foreground text-sm font-normal">{grouped[cat].length} items</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right">Current Stock</TableHead>
                    <TableHead>Last Checked</TableHead>
                    <TableHead>Checked By</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped[cat].map(item => {
                    const stock = fmtStock(item);
                    return (
                    <TableRow key={item.id} data-testid={`row-storage-${item.id}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{getStoreName(item.storeId)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {stock === null
                          ? <span className="text-muted-foreground/50 text-sm">—</span>
                          : stock.color === "destructive"
                            ? <Badge variant="destructive" className="font-normal">{stock.label}</Badge>
                            : stock.color === "warning"
                              ? <span className="text-amber-600 dark:text-amber-400 font-semibold text-sm">{stock.label}</span>
                              : <span className="font-semibold">{stock.label}</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(item.lastCheckedAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.lastCheckedBy ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(item)}
                            data-testid={`button-edit-storage-${item.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteConfirmId(item.id)}
                            data-testid={`button-delete-storage-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        {/* Create / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editItem ? "Edit Storage Item" : "New Storage Item"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Soy Sauce"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  data-testid="input-storage-form-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger data-testid="select-storage-form-category">
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {STORAGE_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={formUnit} onValueChange={setFormUnit}>
                  <SelectTrigger data-testid="select-storage-form-unit">
                    <SelectValue placeholder="Unit…" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map(u => (
                      <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Store</Label>
                <Select value={formStoreId} onValueChange={setFormStoreId}>
                  <SelectTrigger data-testid="select-storage-form-store">
                    <SelectValue placeholder="All Stores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_STORES}>All Stores</SelectItem>
                    {stores.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                disabled={!formName.trim() || !formCategory || createMutation.isPending || updateMutation.isPending}
                onClick={handleSave}
                data-testid="button-save-storage-item"
              >
                {editItem ? "Save Changes" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm Dialog */}
        <Dialog open={deleteConfirmId !== null} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Item</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">이 아이템을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => { if (deleteConfirmId !== null) deleteMutation.mutate(deleteConfirmId); }}
                data-testid="button-confirm-delete-storage"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
