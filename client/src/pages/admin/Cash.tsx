import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Wallet, Receipt, AlertTriangle, ChevronLeft, ChevronRight, Pencil, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Store, DailyClosing, DailyCloseForm } from "@shared/schema";
import { STORE_COLORS as STORE_BRAND } from "@shared/storeColors";
import { useAdminRole } from "@/contexts/AdminRoleContext";

// ─── Date helpers (local-calendar, no UTC drift) ────────────────────────────
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toYMD(d);
}
function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  d.setDate(d.getDate() + n);
  return toYMD(d);
}
function fmtWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function fmtRowDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const dow = d.toLocaleDateString("en-AU", { weekday: "short" });
  return `${dd}/${mm}/${yy}, ${dow}`;
}

// Edit form mirrors the editable surface of a DailyClosing. Numeric fields
// are kept as strings while typing; we coerce on submit. creditAmount and
// differenceAmount are recomputed live from the inputs on save.
type EditFields = {
  date: string;
  storeId: string;
  staffNames: string;
  previousFloat: string;
  salesTotal: string;
  cashSales: string;
  cashOut: string;
  actualCashCounted: string;
  nextFloat: string;
  ubereatsAmount: string;
  doordashAmount: string;
  notes: string;
};

function closingToEditFields(c: DailyClosing): EditFields {
  return {
    date: c.date,
    storeId: c.storeId,
    staffNames: c.staffNames ?? "",
    previousFloat: String(c.previousFloat ?? 0),
    salesTotal: String(c.salesTotal ?? 0),
    cashSales: String(c.cashSales ?? 0),
    cashOut: String(c.cashOut ?? 0),
    actualCashCounted: String(c.actualCashCounted ?? 0),
    nextFloat: String(c.nextFloat ?? 0),
    ubereatsAmount: String(c.ubereatsAmount ?? 0),
    doordashAmount: String(c.doordashAmount ?? 0),
    notes: c.notes ?? "",
  };
}

const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export function AdminCash() {
  const { currentRole } = useAdminRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [weekStart, setWeekStart] = useState<string>(() => getMonday(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const startDate = weekStart;
  const endDate = weekEnd;

  const [editing, setEditing] = useState<{ id: string; fields: EditFields } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DailyClosing | null>(null);

  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  // Cash & Daily Close is only relevant to Sushi + Sandwich operations.
  const activeStores = useMemo(
    () => (stores ?? []).filter(s => s.active && /sushi|sandwich/i.test(s.name)),
    [stores],
  );

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (storeFilter !== "all") params.append("store_id", storeFilter);
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
    return params.toString();
  };

  const { data: dailyClosings, isLoading: closingsLoading } = useQuery<DailyClosing[]>({
    queryKey: ["/api/daily-closings", storeFilter, startDate, endDate],
    queryFn: async () => {
      const query = buildQuery();
      const res = await fetch(`/api/daily-closings${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // Cash Details now reads from daily_close_forms — the same record the
  // mobile flow already writes (denominations + envelope + counted). No
  // separate cashSalesDetails write path is needed.
  const { data: closeForms, isLoading: cashLoading } = useQuery<DailyCloseForm[]>({
    queryKey: ["/api/daily-close-forms", storeFilter, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (storeFilter !== "all") params.append("storeId", storeFilter);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      const q = params.toString();
      const res = await fetch(`/api/daily-close-forms${q ? `?${q}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: currentRole !== "MANAGER",
  });

  const getStoreName = (storeId: string) => {
    return stores?.find(s => s.id === storeId)?.name || "-";
  };

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; fields: EditFields }) => {
      const f = vars.fields;
      const previousFloat = num(f.previousFloat);
      const salesTotal = num(f.salesTotal);
      const cashSales = num(f.cashSales);
      const cashOut = num(f.cashOut);
      const nextFloat = num(f.nextFloat);
      const actualCashCounted = num(f.actualCashCounted);
      const creditAmount = previousFloat + cashSales - cashOut - nextFloat;
      const differenceAmount = creditAmount - actualCashCounted;
      const body = {
        date: f.date,
        storeId: f.storeId,
        staffNames: f.staffNames || null,
        previousFloat,
        salesTotal,
        cashSales,
        cashOut,
        nextFloat,
        actualCashCounted,
        creditAmount,
        differenceAmount,
        ubereatsAmount: num(f.ubereatsAmount),
        doordashAmount: num(f.doordashAmount),
        notes: f.notes || null,
      };
      await apiRequest("PUT", `/api/daily-closings/${vars.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setEditing(null);
      toast({ title: "Daily closing updated" });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/daily-closings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-closings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-close-forms"] });
      setConfirmDelete(null);
      toast({ title: "Daily closing deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete entry", variant: "destructive" });
    },
  });

  const isLoading = closingsLoading || cashLoading;

  if (isLoading) {
    return (
      <AdminLayout title="Cash & Daily Close">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  // Live-computed credit + difference inside the edit dialog so the user
  // can see the impact of their edits before saving.
  const editPreview = (() => {
    if (!editing) return null;
    const f = editing.fields;
    const credit = num(f.previousFloat) + num(f.cashSales) - num(f.cashOut) - num(f.nextFloat);
    const diff = credit - num(f.actualCashCounted);
    return { credit, diff };
  })();

  return (
    <AdminLayout title="Cash & Daily Close">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle className="text-base">Filter</CardTitle>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1 flex-wrap">
                  {[{ id: "all", name: "All Stores" }, ...activeStores].map(store => {
                    const isActive = storeFilter === store.id;
                    const brandColor = STORE_BRAND[store.name] ?? null;
                    return (
                      <button
                        key={store.id}
                        onClick={() => setStoreFilter(store.id)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          isActive ? "text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                        }`}
                        style={isActive ? { backgroundColor: brandColor ?? "#1a1a1a" } : {}}
                        data-testid={`button-store-filter-${store.id}`}
                      >
                        {store.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center border rounded-md">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setWeekStart(addDays(weekStart, -7))}
                    data-testid="button-prev-week"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 text-sm font-medium whitespace-nowrap" data-testid="text-week-range">
                    {fmtWeekLabel(weekStart)} – {fmtWeekLabel(weekEnd)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setWeekStart(addDays(weekStart, 7))}
                    data-testid="button-next-week"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="closings">
          <TabsList>
            <TabsTrigger value="closings" data-testid="tab-closings">
              <Receipt className="w-4 h-4 mr-2" />
              Daily Closings
            </TabsTrigger>
            {currentRole !== "MANAGER" && (
              <TabsTrigger value="cash" data-testid="tab-cash">
                <Wallet className="w-4 h-4 mr-2" />
                Cash Details
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="closings">
            <Card>
              <CardContent className="pt-6">
                {!dailyClosings?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {currentRole === "MANAGER"
                        ? "No daily closings yet."
                        : "일일 마감 기록이 없습니다"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead>Staff</TableHead>
                          <TableHead className="text-right">POS Sales Total</TableHead>
                          <TableHead className="text-right">Cash Amount</TableHead>
                          <TableHead className="text-right">Cash Out</TableHead>
                          <TableHead className="text-right">Expected Cash</TableHead>
                          <TableHead className="text-right">Uber</TableHead>
                          <TableHead className="text-right">DoorDash</TableHead>
                          <TableHead className="text-right">Total Income</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyClosings.map(closing => {
                          const isShortage = closing.differenceAmount > 0;
                          const storeName = getStoreName(closing.storeId);
                          const storeColor = STORE_BRAND[storeName] ?? "#6a6a6a";
                          const totalIncome = closing.salesTotal + closing.ubereatsAmount + closing.doordashAmount;
                          return (
                            <TableRow key={closing.id} data-testid={`row-closing-${closing.id}`}>
                              <TableCell className="whitespace-nowrap">{fmtRowDate(closing.date)}</TableCell>
                              <TableCell>
                                <span
                                  className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                                  style={{ backgroundColor: storeColor }}
                                >
                                  {storeName}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-[150px] truncate">{closing.staffNames || "-"}</TableCell>
                              <TableCell className="text-right">${closing.salesTotal.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.cashSales.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.cashOut.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.creditAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.ubereatsAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right">${closing.doordashAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-medium">${totalIncome.toFixed(2)}</TableCell>
                              <TableCell className="text-right" data-testid={`text-diff-${closing.id}`}>
                                {isShortage ? (
                                  <span className="inline-flex items-center gap-1 text-red-600 font-bold">
                                    <AlertTriangle className="w-3 h-3" />
                                    ${closing.differenceAmount.toFixed(2)}
                                  </span>
                                ) : closing.differenceAmount < 0 ? (
                                  <span className="text-green-600 font-medium">
                                    -${Math.abs(closing.differenceAmount).toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">$0.00</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium">${closing.actualCashCounted.toFixed(2)}</TableCell>
                              <TableCell className="text-right">
                                <div className="inline-flex gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    onClick={() => setEditing({ id: closing.id, fields: closingToEditFields(closing) })}
                                    data-testid={`button-edit-${closing.id}`}
                                    aria-label="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => setConfirmDelete(closing)}
                                    data-testid={`button-delete-${closing.id}`}
                                    aria-label="Delete"
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
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {currentRole !== "MANAGER" && (
          <TabsContent value="cash">
            <Card>
              <CardContent className="pt-6">
                {!closeForms?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>현금 매출 기록이 없습니다</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead>Submitter</TableHead>
                          <TableHead className="text-right">Envelope</TableHead>
                          <TableHead className="text-right">$100</TableHead>
                          <TableHead className="text-right">$50</TableHead>
                          <TableHead className="text-right">$20</TableHead>
                          <TableHead className="text-right">$10</TableHead>
                          <TableHead className="text-right">$5</TableHead>
                          <TableHead className="text-right">Counted</TableHead>
                          <TableHead className="text-right">Diff</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {closeForms.map(f => {
                          const envelope = f.envelopeAmount ?? 0;
                          const counted = f.totalCalculated ?? 0;
                          const diff = counted - envelope;
                          return (
                            <TableRow key={f.id} data-testid={`row-cash-${f.id}`}>
                              <TableCell>{f.date}</TableCell>
                              <TableCell>{getStoreName(f.storeId)}</TableCell>
                              <TableCell className="max-w-[150px] truncate">{f.submitterName || "-"}</TableCell>
                              <TableCell className="text-right">${envelope.toFixed(2)}</TableCell>
                              <TableCell className="text-right">{f.note100Count}</TableCell>
                              <TableCell className="text-right">{f.note50Count}</TableCell>
                              <TableCell className="text-right">{f.note20Count}</TableCell>
                              <TableCell className="text-right">{f.note10Count}</TableCell>
                              <TableCell className="text-right">{f.note5Count}</TableCell>
                              <TableCell className="text-right">${counted.toFixed(2)}</TableCell>
                              <TableCell className={`text-right font-medium ${diff !== 0 ? (diff > 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                                {diff !== 0 && (diff > 0 ? '+' : '')}${diff.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Daily Closing</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-date">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editing.fields.date}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, date: e.target.value } })}
                  data-testid="input-edit-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-store">Store</Label>
                <Select
                  value={editing.fields.storeId}
                  onValueChange={(v) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, storeId: v } })}
                >
                  <SelectTrigger id="edit-store" data-testid="select-edit-store">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(stores ?? []).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="edit-staff">Staff</Label>
                <Input
                  id="edit-staff"
                  value={editing.fields.staffNames}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, staffNames: e.target.value } })}
                  data-testid="input-edit-staff"
                />
              </div>
              {([
                ["previousFloat", "Previous Float"],
                ["salesTotal", "POS Sales Total"],
                ["cashSales", "Cash Amount"],
                ["cashOut", "Cash Out"],
                ["actualCashCounted", "Credit"],
                ["nextFloat", "Next Float"],
                ["ubereatsAmount", "Uber"],
                ["doordashAmount", "DoorDash"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`edit-${key}`}>{label}</Label>
                  <Input
                    id={`edit-${key}`}
                    type="text"
                    inputMode="decimal"
                    value={editing.fields[key]}
                    onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, [key]: e.target.value } })}
                    data-testid={`input-edit-${key}`}
                  />
                </div>
              ))}
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={editing.fields.notes}
                  onChange={(e) => setEditing(prev => prev && { ...prev, fields: { ...prev.fields, notes: e.target.value } })}
                  data-testid="input-edit-notes"
                />
              </div>
              {editPreview && (
                <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-md border bg-muted/40 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Expected Cash (computed)</p>
                    <p className="text-base font-semibold">${editPreview.credit.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Difference (computed)</p>
                    <p className={`text-base font-semibold ${editPreview.diff > 0.005 ? "text-red-600" : editPreview.diff < -0.005 ? "text-green-600" : ""}`}>
                      ${editPreview.diff.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} data-testid="button-edit-cancel">Cancel</Button>
            <Button
              onClick={() => editing && updateMutation.mutate(editing)}
              disabled={!editing || updateMutation.isPending}
              data-testid="button-edit-save"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this daily closing?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  This will permanently remove the {confirmDelete.date} entry for {getStoreName(confirmDelete.storeId)} and the matching cash-detail row. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
