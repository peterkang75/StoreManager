import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Clock, CalendarDays, Sun, BookOpen, Plus, Trash2, Pencil, Save, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store, StoreTradingHours, SchoolHoliday, PublicHoliday, StoreRecommendedHours } from "@shared/schema";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = typeof DAYS[number];

const DAY_LABELS: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function fmt12(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")}${period}`;
}

function isRosterStore(s: Store) {
  const n = s.name.toLowerCase();
  return n.includes("sushi") || n.includes("sandwich");
}

// ─── TimeSelect ───────────────────────────────────────────────────────────────
function TimeSelect({ value, onChange, disabled, testId }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-28 text-sm" data-testid={testId}>
        <SelectValue placeholder="--:--" />
      </SelectTrigger>
      <SelectContent className="max-h-60">
        {TIME_SLOTS.map((t) => (
          <SelectItem key={t} value={t}>{fmt12(t)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Section 1: Trading Hours ─────────────────────────────────────────────────
function TradingHoursSection({ stores }: { stores: Store[] }) {
  const { toast } = useToast();
  const rosterStores = stores.filter(isRosterStore)
    .sort((a, b) => {
      const aIsSushi = a.name.toLowerCase().includes("sushi");
      const bIsSushi = b.name.toLowerCase().includes("sushi");
      return aIsSushi === bIsSushi ? 0 : aIsSushi ? -1 : 1;
    });

  const [selectedStoreId, setSelectedStoreId] = useState<string>(rosterStores[0]?.id ?? "");

  const { data: hours = [], isLoading } = useQuery<StoreTradingHours[]>({
    queryKey: ["/api/store-config/trading-hours", selectedStoreId],
    enabled: !!selectedStoreId,
  });

  const hoursMap: Record<string, StoreTradingHours> = {};
  for (const h of hours) {
    hoursMap[h.dayOfWeek] = h;
  }

  const [draft, setDraft] = useState<Record<string, Partial<StoreTradingHours>>>({});

  const getDayValue = (day: Day, field: keyof StoreTradingHours) => {
    if (draft[day]?.[field] !== undefined) return draft[day][field] as string | boolean;
    return hoursMap[day]?.[field] ?? (field === "isClosed" ? false : field === "openTime" ? "09:00" : "21:00");
  };

  const setDayField = (day: Day, field: "openTime" | "closeTime" | "isClosed", value: string | boolean) => {
    setDraft(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const saveMutation = useMutation({
    mutationFn: async (day: Day) => {
      const current = hoursMap[day];
      const d = draft[day] ?? {};
      const payload = {
        storeId: selectedStoreId,
        dayOfWeek: day,
        openTime: (d.openTime ?? current?.openTime ?? "09:00"),
        closeTime: (d.closeTime ?? current?.closeTime ?? "21:00"),
        isClosed: (d.isClosed ?? current?.isClosed ?? false),
      };
      return apiRequest("PUT", "/api/store-config/trading-hours", payload);
    },
    onSuccess: (_data, day) => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/trading-hours", selectedStoreId] });
      setDraft(prev => { const n = { ...prev }; delete n[day]; return n; });
      toast({ title: "Saved", description: `${DAY_LABELS[day]} trading hours updated.` });
    },
    onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">매장 선택:</p>
        <div className="flex gap-2">
          {rosterStores.map(s => (
            <Button
              key={s.id}
              variant={selectedStoreId === s.id ? "default" : "outline"}
              size="sm"
              onClick={() => { setSelectedStoreId(s.id); setDraft({}); }}
              data-testid={`btn-store-${s.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {s.name}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">영업 시간 — {rosterStores.find(s => s.id === selectedStoreId)?.name}</CardTitle>
          <CardDescription className="text-xs">각 요일의 영업 시작·종료 시간을 설정하세요. 휴무일은 Closed 토글을 켜주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {DAYS.map(d => <Skeleton key={d} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {DAYS.map(day => {
                const isClosed = getDayValue(day, "isClosed") as boolean;
                const openTime = getDayValue(day, "openTime") as string;
                const closeTime = getDayValue(day, "closeTime") as string;
                const isDirty = !!draft[day] && Object.keys(draft[day]).length > 0;
                return (
                  <div key={day} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="w-28 text-sm font-medium">{DAY_LABELS[day]}</div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isClosed}
                        onCheckedChange={v => setDayField(day, "isClosed", v)}
                        data-testid={`switch-closed-${day}`}
                      />
                      <span className="text-xs text-muted-foreground w-12">{isClosed ? "Closed" : "Open"}</span>
                    </div>
                    {!isClosed && (
                      <>
                        <TimeSelect
                          value={openTime}
                          onChange={v => setDayField(day, "openTime", v)}
                          testId={`select-open-${day}`}
                        />
                        <span className="text-xs text-muted-foreground">→</span>
                        <TimeSelect
                          value={closeTime}
                          onChange={v => setDayField(day, "closeTime", v)}
                          testId={`select-close-${day}`}
                        />
                      </>
                    )}
                    {isDirty && (
                      <Button
                        size="sm"
                        onClick={() => saveMutation.mutate(day)}
                        disabled={saveMutation.isPending}
                        data-testid={`btn-save-hours-${day}`}
                      >
                        {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        <span className="ml-1">Save</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Section 2: School Holidays ───────────────────────────────────────────────
function SchoolHolidaysSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });

  const { data: holidays = [], isLoading } = useQuery<SchoolHoliday[]>({
    queryKey: ["/api/store-config/school-holidays"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/store-config/school-holidays", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/school-holidays"] });
      setDialogOpen(false);
      toast({ title: "Saved", description: "School holiday period added." });
    },
    onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form & { id: number }) =>
      apiRequest("PUT", `/api/store-config/school-holidays/${data.id}`, {
        name: data.name, startDate: data.startDate, endDate: data.endDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/school-holidays"] });
      setDialogOpen(false);
      toast({ title: "Saved", description: "School holiday period updated." });
    },
    onError: () => toast({ title: "Error", description: "Failed to update.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/store-config/school-holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/school-holidays"] });
      setDeleteId(null);
      toast({ title: "Deleted", description: "School holiday removed." });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }),
  });

  function openCreate() {
    setEditId(null);
    setForm({ name: "", startDate: "", endDate: "" });
    setDialogOpen(true);
  }

  function openEdit(h: SchoolHoliday) {
    setEditId(h.id);
    setForm({ name: h.name, startDate: h.startDate, endDate: h.endDate });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.name || !form.startDate || !form.endDate) {
      toast({ title: "Validation", description: "All fields are required.", variant: "destructive" });
      return;
    }
    if (editId !== null) {
      updateMutation.mutate({ ...form, id: editId });
    } else {
      createMutation.mutate(form);
    }
  }

  function fmtDate(d: string) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">학교 방학 기간을 설정하세요 (호주 빅토리아주 기준, 연 4회).</p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="btn-add-school-holiday">
          <Plus className="w-4 h-4 mr-1" /> Add Holiday Period
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : holidays.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No school holiday periods configured yet.</p>
          ) : (
            <div className="space-y-2">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center justify-between py-2 border-b last:border-0" data-testid={`row-school-holiday-${h.id}`}>
                  <div>
                    <p className="text-sm font-medium">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(h.startDate)} → {fmtDate(h.endDate)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(h)} data-testid={`btn-edit-holiday-${h.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteId(h.id)} data-testid={`btn-delete-holiday-${h.id}`}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Edit" : "Add"} School Holiday Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="holiday-name">Period Name</Label>
              <Input
                id="holiday-name"
                placeholder="e.g. Summer Holidays 2025"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                data-testid="input-holiday-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="holiday-start">Start Date</Label>
                <Input
                  id="holiday-start"
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
                  data-testid="input-holiday-start"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="holiday-end">End Date</Label>
                <Input
                  id="holiday-end"
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))}
                  data-testid="input-holiday-end"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isBusy} data-testid="btn-save-school-holiday">
              {isBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holiday Period?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="btn-confirm-delete-holiday"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Section 3: Public Holidays ───────────────────────────────────────────────
function PublicHolidaysSection({ stores }: { stores: Store[] }) {
  const { toast } = useToast();
  const rosterStores = stores.filter(isRosterStore)
    .sort((a, b) => {
      const aIsSushi = a.name.toLowerCase().includes("sushi");
      return aIsSushi ? -1 : 1;
    });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", date: "", storeClosures: {} as Record<string, boolean> });

  const { data: holidays = [], isLoading } = useQuery<PublicHoliday[]>({
    queryKey: ["/api/store-config/public-holidays"],
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/store-config/public-holidays", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/public-holidays"] });
      setDialogOpen(false);
      toast({ title: "Saved", description: "Public holiday added." });
    },
    onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form & { id: number }) =>
      apiRequest("PUT", `/api/store-config/public-holidays/${data.id}`, {
        name: data.name, date: data.date, storeClosures: data.storeClosures,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/public-holidays"] });
      setDialogOpen(false);
      toast({ title: "Saved", description: "Public holiday updated." });
    },
    onError: () => toast({ title: "Error", description: "Failed to update.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/store-config/public-holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/public-holidays"] });
      setDeleteId(null);
      toast({ title: "Deleted", description: "Public holiday removed." });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete.", variant: "destructive" }),
  });

  function openCreate() {
    setEditId(null);
    setForm({ name: "", date: "", storeClosures: {} });
    setDialogOpen(true);
  }

  function openEdit(h: PublicHoliday) {
    setEditId(h.id);
    setForm({
      name: h.name,
      date: h.date,
      storeClosures: (h.storeClosures as Record<string, boolean>) ?? {},
    });
    setDialogOpen(true);
  }

  function toggleClosure(storeId: string, closed: boolean) {
    setForm(prev => ({
      ...prev,
      storeClosures: { ...prev.storeClosures, [storeId]: closed },
    }));
  }

  function handleSave() {
    if (!form.name || !form.date) {
      toast({ title: "Validation", description: "Name and date are required.", variant: "destructive" });
      return;
    }
    if (editId !== null) {
      updateMutation.mutate({ ...form, id: editId });
    } else {
      createMutation.mutate(form);
    }
  }

  function fmtDate(d: string) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }

  const isBusy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">공휴일 목록과 각 매장의 휴무 여부를 설정하세요.</p>
        <Button size="sm" onClick={openCreate} data-testid="btn-add-public-holiday">
          <Plus className="w-4 h-4 mr-1" /> Add Public Holiday
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : holidays.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No public holidays configured yet.</p>
          ) : (
            <div className="space-y-0">
              {/* Header */}
              <div className="flex items-center gap-3 pb-2 border-b text-xs text-muted-foreground font-medium">
                <div className="flex-1">Holiday</div>
                <div className="w-20 text-center">Date</div>
                {rosterStores.map(s => (
                  <div key={s.id} className="w-20 text-center">{s.name.split(" ")[0]}</div>
                ))}
                <div className="w-16" />
              </div>
              {holidays.map(h => {
                const closures = (h.storeClosures as Record<string, boolean>) ?? {};
                return (
                  <div key={h.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" data-testid={`row-public-holiday-${h.id}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{h.name}</p>
                    </div>
                    <div className="w-20 text-center text-xs text-muted-foreground">{fmtDate(h.date)}</div>
                    {rosterStores.map(s => (
                      <div key={s.id} className="w-20 flex justify-center">
                        {closures[s.id] ? (
                          <Badge variant="destructive" className="text-xs">Closed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Open</Badge>
                        )}
                      </div>
                    ))}
                    <div className="w-16 flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(h)} data-testid={`btn-edit-ph-${h.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteId(h.id)} data-testid={`btn-delete-ph-${h.id}`}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Edit" : "Add"} Public Holiday</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="ph-name">Holiday Name</Label>
              <Input
                id="ph-name"
                placeholder="e.g. Australia Day"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                data-testid="input-ph-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ph-date">Date</Label>
              <Input
                id="ph-date"
                type="date"
                value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                data-testid="input-ph-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Store Closure</Label>
              <p className="text-xs text-muted-foreground">해당 매장이 공휴일에 문을 닫으면 켜주세요.</p>
              <div className="space-y-2">
                {rosterStores.map(s => (
                  <div key={s.id} className="flex items-center justify-between">
                    <span className="text-sm">{s.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {form.storeClosures[s.id] ? "Closed" : "Open"}
                      </span>
                      <Switch
                        checked={!!form.storeClosures[s.id]}
                        onCheckedChange={v => toggleClosure(s.id, v)}
                        data-testid={`switch-closure-${s.id}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isBusy} data-testid="btn-save-public-holiday">
              {isBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Public Holiday?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="btn-confirm-delete-ph"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Section 4: Recommended Hours ────────────────────────────────────────────
function RecommendedHoursSection({ stores }: { stores: Store[] }) {
  const { toast } = useToast();
  const rosterStores = stores.filter(isRosterStore)
    .sort((a, b) => {
      const aIsSushi = a.name.toLowerCase().includes("sushi");
      return aIsSushi ? -1 : 1;
    });

  const { data: allHours = [], isLoading } = useQuery<StoreRecommendedHours[]>({
    queryKey: ["/api/store-config/recommended-hours"],
  });

  const hoursMap: Record<string, StoreRecommendedHours> = {};
  for (const h of allHours) {
    hoursMap[h.storeId] = h;
  }

  const [draft, setDraft] = useState<Record<string, { termWeeklyHours?: number; holidayWeeklyHours?: number }>>({});

  const saveMutation = useMutation({
    mutationFn: async (storeId: string) => {
      const current = hoursMap[storeId];
      const d = draft[storeId] ?? {};
      return apiRequest("PUT", "/api/store-config/recommended-hours", {
        storeId,
        termWeeklyHours: d.termWeeklyHours ?? current?.termWeeklyHours ?? 38,
        holidayWeeklyHours: d.holidayWeeklyHours ?? current?.holidayWeeklyHours ?? 38,
      });
    },
    onSuccess: (_data, storeId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/store-config/recommended-hours"] });
      setDraft(prev => { const n = { ...prev }; delete n[storeId]; return n; });
      toast({ title: "Saved", description: "Recommended hours updated." });
    },
    onError: () => toast({ title: "Error", description: "Failed to save.", variant: "destructive" }),
  });

  function getVal(storeId: string, field: "termWeeklyHours" | "holidayWeeklyHours"): number {
    if (draft[storeId]?.[field] !== undefined) return draft[storeId][field]!;
    return hoursMap[storeId]?.[field] ?? 38;
  }

  function setVal(storeId: string, field: "termWeeklyHours" | "holidayWeeklyHours", value: number) {
    setDraft(prev => ({ ...prev, [storeId]: { ...prev[storeId], [field]: value } }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">학기 중과 방학 중의 매장별 주간 권장 근무시간을 설정하세요. 로스터 생성 시 참고 기준으로 사용됩니다.</p>

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading
          ? [1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)
          : rosterStores.map(store => {
              const isDirty = !!draft[store.id] && Object.keys(draft[store.id]).length > 0;
              const isSushi = store.name.toLowerCase().includes("sushi");
              return (
                <Card key={store.id} data-testid={`card-rec-hours-${store.id}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: isSushi ? "#222222" : "#ef4444" }}
                      />
                      {store.name}
                    </CardTitle>
                    <CardDescription className="text-xs">주간 권장 근무시간 (시간 단위)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">
                          <BookOpen className="w-3 h-3 inline mr-1" />
                          학기 중 (Term)
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={80}
                          step={0.5}
                          value={getVal(store.id, "termWeeklyHours")}
                          onChange={e => setVal(store.id, "termWeeklyHours", parseFloat(e.target.value) || 0)}
                          data-testid={`input-term-hours-${store.id}`}
                        />
                        <p className="text-xs text-muted-foreground text-right">{getVal(store.id, "termWeeklyHours")}h/week</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          <Sun className="w-3 h-3 inline mr-1" />
                          방학 중 (Holiday)
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={80}
                          step={0.5}
                          value={getVal(store.id, "holidayWeeklyHours")}
                          onChange={e => setVal(store.id, "holidayWeeklyHours", parseFloat(e.target.value) || 0)}
                          data-testid={`input-holiday-hours-${store.id}`}
                        />
                        <p className="text-xs text-muted-foreground text-right">{getVal(store.id, "holidayWeeklyHours")}h/week</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!isDirty || saveMutation.isPending}
                      onClick={() => saveMutation.mutate(store.id)}
                      data-testid={`btn-save-rec-hours-${store.id}`}
                    >
                      {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                      Save
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AdminStoreConfig() {
  const { data: stores = [], isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  return (
    <AdminLayout title="Store Settings">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Store Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            매장별 운영 설정 — 영업시간, 방학 기간, 공휴일, 권장 근무시간
          </p>
        </div>

        {storesLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Tabs defaultValue="trading-hours">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="trading-hours" data-testid="tab-trading-hours">
                <Clock className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Trading Hours</span>
                <span className="sm:hidden">Hours</span>
              </TabsTrigger>
              <TabsTrigger value="school-holidays" data-testid="tab-school-holidays">
                <BookOpen className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">School Holidays</span>
                <span className="sm:hidden">School</span>
              </TabsTrigger>
              <TabsTrigger value="public-holidays" data-testid="tab-public-holidays">
                <CalendarDays className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Public Holidays</span>
                <span className="sm:hidden">Public</span>
              </TabsTrigger>
              <TabsTrigger value="recommended-hours" data-testid="tab-recommended-hours">
                <Sun className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Recommended Hours</span>
                <span className="sm:hidden">Rec. Hours</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="trading-hours" className="mt-4">
              <TradingHoursSection stores={stores} />
            </TabsContent>
            <TabsContent value="school-holidays" className="mt-4">
              <SchoolHolidaysSection />
            </TabsContent>
            <TabsContent value="public-holidays" className="mt-4">
              <PublicHolidaysSection stores={stores} />
            </TabsContent>
            <TabsContent value="recommended-hours" className="mt-4">
              <RecommendedHoursSection stores={stores} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AdminLayout>
  );
}
