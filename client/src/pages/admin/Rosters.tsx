import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Clock,
  AlertTriangle,
  Trash2,
  Calendar,
  Plus,
  Rocket,
  CheckCircle2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Store, Employee, Roster } from "@shared/schema";

// ─── Date helpers ───────────────────────────────────────────────────────────
function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function getWeekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function fmtShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Time helpers ────────────────────────────────────────────────────────────
// 30-minute increment time slots: 00:00 → 23:30
const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2).toString().padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function snapTo30(t: string): string {
  if (!t) return "06:00";
  const [h, m] = t.split(":").map(Number);
  const snapped = m < 30 ? "00" : "30";
  return `${h.toString().padStart(2, "0")}:${snapped}`;
}

function TimeSelect({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <Select value={snapTo30(value)} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-48">
        {TIME_SLOTS.map((t) => (
          <SelectItem key={t} value={t} className="text-xs font-mono">
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function toMins(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function calcHours(start: string, end: string): number {
  const diff = toMins(end) - toMins(start);
  return diff > 0 ? diff / 60 : 0;
}

function isOutsideHours(start: string, end: string, open: string, close: string): boolean {
  return toMins(start) < toMins(open) || toMins(end) > toMins(close);
}

// ─── Cell editor popover ─────────────────────────────────────────────────────
interface CellEditorProps {
  roster: Roster | undefined;
  storeOpenTime: string;
  storeCloseTime: string;
  onSave: (start: string, end: string) => void;
  onClear: () => void;
  isPending: boolean;
  mobileMode?: boolean;
}

function CellEditor({ roster, storeOpenTime, storeCloseTime, onSave, onClear, isPending, mobileMode }: CellEditorProps) {
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState(roster?.startTime ?? storeOpenTime);
  const [endTime, setEndTime] = useState(roster?.endTime ?? storeCloseTime);

  const handleOpen = (o: boolean) => {
    if (o) {
      setStartTime(roster?.startTime ?? storeOpenTime);
      setEndTime(roster?.endTime ?? storeCloseTime);
    }
    setOpen(o);
  };

  const hours = calcHours(startTime, endTime);
  const outsideHours = startTime && endTime ? isOutsideHours(startTime, endTime, storeOpenTime, storeCloseTime) : false;

  const handleSave = () => {
    if (!startTime || !endTime) return;
    onSave(startTime, endTime);
    setOpen(false);
  };

  const handleClear = () => {
    onClear();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        {mobileMode ? (
          <Button
            size="sm"
            variant={roster ? "outline" : "default"}
            className="text-xs h-8 px-3"
            data-testid="mobile-cell-roster"
          >
            {roster ? "Edit" : (
              <span className="flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Add</span>
            )}
          </Button>
        ) : (
          <button
            type="button"
            className={`w-full min-h-[40px] text-xs rounded-md px-1.5 py-1 text-left transition-colors
              ${roster
                ? "bg-primary/10 hover:bg-primary/20 text-primary font-medium"
                : "hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground"
              }`}
            data-testid="cell-roster"
          >
            {roster ? (
              <span className="flex flex-col gap-0.5">
                <span>{roster.startTime}</span>
                <span className="text-muted-foreground font-normal">→ {roster.endTime}</span>
                <span className="text-[10px] text-muted-foreground">{calcHours(roster.startTime, roster.endTime).toFixed(1)}h</span>
              </span>
            ) : (
              <span className="text-center block">—</span>
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" side="bottom" align="center">
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Start</p>
              <TimeSelect value={startTime} onChange={setStartTime} testId="input-start-time" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">End</p>
              <TimeSelect value={endTime} onChange={setEndTime} testId="input-end-time" />
            </div>
          </div>

          {/* Quick fill */}
          <div className="flex gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => { setStartTime(storeOpenTime); setEndTime(storeCloseTime); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
            >
              Full day
            </button>
            <button
              type="button"
              onClick={() => { setStartTime(storeOpenTime); setEndTime(addHalfDay(storeOpenTime, storeCloseTime)); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
            >
              Open shift
            </button>
            <button
              type="button"
              onClick={() => { setStartTime(addHalfDay(storeOpenTime, storeCloseTime)); setEndTime(storeCloseTime); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
            >
              Close shift
            </button>
          </div>

          {/* Preview & warning */}
          {startTime && endTime && (
            <div className="text-xs text-muted-foreground">
              {hours > 0 ? `${hours.toFixed(1)} hrs` : "Invalid range"}
              {outsideHours && (
                <span className="flex items-center gap-1 text-amber-600 mt-0.5">
                  <AlertTriangle className="h-3 w-3" />
                  Outside store hours ({storeOpenTime}–{storeCloseTime})
                </span>
              )}
            </div>
          )}

          <div className="flex gap-1.5 pt-1">
            <Button size="sm" onClick={handleSave} disabled={isPending || hours <= 0} className="flex-1" data-testid="button-save-shift">
              {isPending ? "Saving…" : "Save"}
            </Button>
            {roster && (
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={isPending} data-testid="button-clear-shift">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function addHalfDay(open: string, close: string): string {
  const raw = Math.round((toMins(open) + toMins(close)) / 2);
  const snapped = Math.round(raw / 30) * 30;
  const h = Math.floor(snapped / 60).toString().padStart(2, "0");
  const m = (snapped % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AdminRosters() {
  const { toast } = useToast();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const weekEnd = addDays(weekStart, 6);
  const weekDates = getWeekDates(weekStart);
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const today = new Date().toISOString().split("T")[0];
    const monday = getMonday(new Date());
    const weekDs = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return weekDs.includes(today) ? today : monday;
  });

  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({ queryKey: ["/api/stores"] });

  const activeStores = stores?.filter((s) => s.active && !s.isExternal) ?? [];

  const selectedStoreObj = activeStores.find((s) => s.id === selectedStore);

  // Auto-select first store
  const [autoSelected, setAutoSelected] = useState(false);
  if (!autoSelected && activeStores.length > 0 && !selectedStore) {
    setSelectedStore(activeStores[0].id);
    setAutoSelected(true);
  }

  const { data: employees, isLoading: empLoading } = useQuery<{ employee: Employee; assignment: { storeId: string; rate?: string | null; fixedAmount?: string | null } }[]>({
    queryKey: ["/api/rosters/employees", selectedStore],
    enabled: !!selectedStore,
    queryFn: async () => {
      const res = await fetch(`/api/rosters/employees?store_id=${selectedStore}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const activeEmployees = (employees ?? [])
    .filter((e) => e.employee.status === "ACTIVE")
    .sort((a, b) => {
      const na = `${a.employee.firstName} ${a.employee.lastName}`;
      const nb = `${b.employee.firstName} ${b.employee.lastName}`;
      return na.localeCompare(nb);
    });

  const { data: rostersData, isLoading: rostersLoading } = useQuery<Roster[]>({
    queryKey: ["/api/rosters", selectedStore, weekStart, weekEnd],
    enabled: !!selectedStore,
    queryFn: async () => {
      const url = `/api/rosters?storeId=${selectedStore}&startDate=${weekStart}&endDate=${weekEnd}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const rosterMap = new Map<string, Roster>();
  rostersData?.forEach((r) => rosterMap.set(`${r.employeeId}|${r.date}`, r));

  const invalidateRosters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/rosters", selectedStore, weekStart, weekEnd] });
  }, [selectedStore, weekStart, weekEnd]);

  const upsertMutation = useMutation({
    mutationFn: async (payload: { employeeId: string; date: string; startTime: string; endTime: string }) => {
      const res = await fetch("/api/rosters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId: selectedStore,
          employeeId: payload.employeeId,
          date: payload.date,
          startTime: payload.startTime,
          endTime: payload.endTime,
        }),
      });
      if (!res.ok) {
        let msg = "Failed to save roster";
        try {
          const body = await res.json();
          msg = body.error ?? body.message ?? msg;
        } catch {
          msg = await res.text().catch(() => msg);
        }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => invalidateRosters(),
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/rosters/${id}`);
    },
    onSuccess: () => invalidateRosters(),
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const copyWeekMutation = useMutation({
    mutationFn: async () => {
      const prevStart = addDays(weekStart, -7);
      const prevEnd = addDays(weekStart, -1);
      const res = await apiRequest("POST", "/api/rosters/copy-week", {
        storeId: selectedStore,
        fromStart: prevStart,
        fromEnd: prevEnd,
        toStart: weekStart,
        toEnd: weekEnd,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Week copied", description: `${data.copied} shift(s) copied from previous week.` });
      invalidateRosters();
    },
    onError: (err: Error) => {
      toast({ title: "Copy failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Publish status ─────────────────────────────────────────────────────────
  const publishQueryKey = ["/api/rosters/published", selectedStore, weekStart];
  const { data: publishData } = useQuery<{ published: boolean }>({
    queryKey: publishQueryKey,
    enabled: !!selectedStore,
    queryFn: async () => {
      const res = await fetch(`/api/rosters/published?storeId=${selectedStore}&weekStart=${weekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch publish status");
      return res.json();
    },
  });
  const isPublished = publishData?.published ?? false;

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/rosters/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ storeId: selectedStore, weekStart }),
      });
      if (!res.ok) throw new Error("Failed to toggle publish");
      return res.json();
    },
    onSuccess: (data: { published: boolean }) => {
      queryClient.setQueryData(publishQueryKey, data);
      toast({
        title: data.published ? "Schedule Published" : "Schedule Unpublished",
        description: data.published
          ? "Employees can now view this week's roster."
          : "The roster is now hidden from employees.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Summary calculations ───────────────────────────────────────────────────
  const empHours = (empId: string) =>
    weekDates.reduce((sum, d) => {
      const r = rosterMap.get(`${empId}|${d}`);
      return r ? sum + calcHours(r.startTime, r.endTime) : sum;
    }, 0);

  const totalStoreHours = activeEmployees.reduce((sum, e) => sum + empHours(e.employee.id), 0);

  const empCost = (emp: Employee) => {
    const rate = parseFloat(emp.rate ?? "0") || 0;
    return empHours(emp.id) * rate;
  };

  const totalStoreCost = activeEmployees.reduce((sum, e) => sum + empCost(e.employee), 0);

  const isLoading = storesLoading || empLoading || rostersLoading;

  return (
    <AdminLayout>
      <div className="flex flex-col h-full">
        {/* ── Header bar ───────────────────────────────────────────────── */}
        <div className="border-b px-4 pt-4 pb-3 flex flex-col gap-3">
          {/* Row 1: Title + Publish button */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
              <h1 className="text-xl font-bold whitespace-nowrap">Roster Builder</h1>
            </div>
            {selectedStore && (
              <Button
                size="sm"
                variant={isPublished ? "outline" : "default"}
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className={`w-full md:w-auto ${isPublished ? "border-green-500 text-green-700 dark:text-green-400" : ""}`}
                data-testid="button-publish-roster"
              >
                {isPublished ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1.5 text-green-600 dark:text-green-400" />
                    Published — Click to Unpublish
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-1.5" />
                    Publish Schedule
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Row 2: Controls – vertical stack on mobile, horizontal on desktop */}
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            {/* Store selector — full width on mobile */}
            <Select value={selectedStore} onValueChange={setSelectedStore} data-testid="select-store">
              <SelectTrigger className="w-full md:w-44" data-testid="trigger-store-select">
                <SelectValue placeholder="Select store…" />
              </SelectTrigger>
              <SelectContent>
                {activeStores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Week navigator — full width on mobile */}
            <div className="flex items-center border rounded-md w-full md:w-auto">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const newStart = addDays(weekStart, -7);
                  setWeekStart(newStart);
                  setSelectedDay(newStart);
                }}
                data-testid="button-prev-week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="flex-1 text-center text-sm font-medium whitespace-nowrap" data-testid="text-week-range">
                {fmtDate(weekStart)} – {fmtDate(weekEnd)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const newStart = addDays(weekStart, 7);
                  setWeekStart(newStart);
                  setSelectedDay(newStart);
                }}
                data-testid="button-next-week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Today + Copy — side-by-side grid on mobile */}
            <div className="grid grid-cols-2 gap-2 md:flex md:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setWeekStart(getMonday(new Date()));
                  setSelectedDay(new Date().toISOString().split("T")[0]);
                }}
                data-testid="button-today"
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyWeekMutation.mutate()}
                disabled={!selectedStore || copyWeekMutation.isPending}
                data-testid="button-copy-week"
              >
                <Copy className="h-4 w-4 mr-1.5" />
                Copy Prev Week
              </Button>
            </div>
          </div>
        </div>

        {/* ── Store hours info ───────────────────────────────────────── */}
        {selectedStoreObj && (
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Store hours: <span className="font-medium text-foreground">{selectedStoreObj.openTime}</span> –{" "}
              <span className="font-medium text-foreground">{selectedStoreObj.closeTime}</span>
            </span>
          </div>
        )}

        {/* ── Mobile: Day selector ribbon ─────────────────────────────── */}
        {selectedStore && (
          <div className="md:hidden border-b bg-background">
            <div className="flex w-full px-2 py-1.5 gap-1">
              {weekDates.map((d, i) => {
                const dayNum = new Date(d).getDate();
                const isActive = d === selectedDay;
                const isToday = d === todayStr;
                const hasSomeShift = activeEmployees.some(({ employee: emp }) => rosterMap.get(`${emp.id}|${d}`));
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDay(d)}
                    className={`flex-1 flex flex-col items-center pt-1.5 pb-1 rounded-md text-xs transition-colors relative
                      ${isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                      }`}
                    data-testid={`button-day-tab-${i}`}
                  >
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${isActive ? "text-primary" : isToday ? "text-primary" : ""}`}>
                      {DAY_NAMES[i]}
                    </span>
                    <span className={`text-sm font-bold leading-tight mt-0.5 ${isActive ? "text-primary" : isToday ? "text-primary" : ""}`}>
                      {dayNum}
                    </span>
                    {/* Active underline pill */}
                    <span className={`mt-1 h-0.5 rounded-full transition-all ${isActive ? "w-4 bg-primary" : hasSomeShift ? "w-1 bg-muted-foreground/40" : "w-0"}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Desktop: 7-day grid ──────────────────────────────────────── */}
        <div className="hidden md:flex flex-1 overflow-auto p-4">
          {!selectedStore ? (
            <div className="flex items-center justify-center h-40 w-full text-muted-foreground">
              Select a store to view the roster.
            </div>
          ) : isLoading ? (
            <div className="space-y-2 w-full">
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="flex items-center justify-center h-40 w-full text-muted-foreground">
              No active employees assigned to this store.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border w-full">
              <table className="w-full text-sm border-collapse table-fixed min-w-[900px]">
                <colgroup>
                  <col style={{ width: "160px" }} />
                  {weekDates.map((d) => <col key={d} style={{ width: "calc((100% - 160px - 100px - 100px) / 7)" }} />)}
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "100px" }} />
                </colgroup>
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium text-sm border-r">
                      Employee
                    </th>
                    {weekDates.map((d, i) => (
                      <th key={d} className={`px-1 py-2 text-center font-medium text-xs border-r ${i >= 5 ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}`} data-testid={`header-day-${i}`}>
                        <div>{DAY_NAMES[i]}</div>
                        <div className="text-muted-foreground font-normal">
                          {new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                        </div>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium text-xs border-r">Hrs</th>
                    <th className="px-2 py-2 text-right font-medium text-xs">Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map(({ employee: emp }) => {
                    const hrs = empHours(emp.id);
                    const cost = empCost(emp);
                    const rate = parseFloat(emp.rate ?? "0") || 0;
                    return (
                      <tr key={emp.id} className="border-b hover-elevate" data-testid={`row-employee-${emp.id}`}>
                        <td className="sticky left-0 z-10 bg-background px-3 py-1.5 border-r">
                          <div className="font-medium text-sm truncate">
                            {emp.nickname || `${emp.firstName} ${emp.lastName}`}
                          </div>
                          {rate > 0 && (
                            <div className="text-xs text-muted-foreground">${rate.toFixed(2)}/hr</div>
                          )}
                        </td>
                        {weekDates.map((d, i) => {
                          const roster = rosterMap.get(`${emp.id}|${d}`);
                          return (
                            <td
                              key={d}
                              className={`px-0.5 py-0.5 border-r align-top ${i >= 5 ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}`}
                              data-testid={`cell-${emp.id}-${d}`}
                            >
                              <CellEditor
                                roster={roster}
                                storeOpenTime={selectedStoreObj?.openTime ?? "06:00"}
                                storeCloseTime={selectedStoreObj?.closeTime ?? "22:00"}
                                onSave={(start, end) =>
                                  upsertMutation.mutate({ employeeId: emp.id, date: d, startTime: start, endTime: end })
                                }
                                onClear={() => roster && deleteMutation.mutate(roster.id)}
                                isPending={upsertMutation.isPending || deleteMutation.isPending}
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 border-r text-right text-xs font-mono tabular-nums" data-testid={`text-hours-${emp.id}`}>
                          {hrs > 0 ? `${hrs.toFixed(1)}h` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums" data-testid={`text-cost-${emp.id}`}>
                          {cost > 0 ? `$${cost.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Mobile: Daily card view ──────────────────────────────────── */}
        <div className="md:hidden flex-1 overflow-auto">
          {!selectedStore ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Select a store to view the roster.
            </div>
          ) : isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No active employees assigned to this store.
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {/* Date label */}
              <p className="text-xs font-medium text-muted-foreground px-1">
                {new Date(selectedDay).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              {activeEmployees.map(({ employee: emp }) => {
                const roster = rosterMap.get(`${emp.id}|${selectedDay}`);
                const rate = parseFloat(emp.rate ?? "0") || 0;
                const hrs = roster ? calcHours(roster.startTime, roster.endTime) : 0;
                return (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 rounded-md border bg-card px-3 py-3"
                    data-testid={`mobile-card-${emp.id}`}
                  >
                    {/* Left: name + rate */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {emp.nickname || `${emp.firstName} ${emp.lastName}`}
                      </p>
                      {rate > 0 && (
                        <p className="text-xs text-muted-foreground">${rate.toFixed(2)}/hr</p>
                      )}
                    </div>

                    {/* Right: shift info + CellEditor trigger */}
                    <div className="shrink-0 flex items-center gap-2">
                      {roster && (
                        <div className="text-right mr-1">
                          <p className="text-xs font-mono font-medium text-primary">{roster.startTime} – {roster.endTime}</p>
                          <p className="text-[10px] text-muted-foreground">{hrs.toFixed(1)} hrs</p>
                        </div>
                      )}
                      <CellEditor
                        roster={roster}
                        storeOpenTime={selectedStoreObj?.openTime ?? "06:00"}
                        storeCloseTime={selectedStoreObj?.closeTime ?? "22:00"}
                        onSave={(start, end) =>
                          upsertMutation.mutate({ employeeId: emp.id, date: selectedDay, startTime: start, endTime: end })
                        }
                        onClear={() => roster && deleteMutation.mutate(roster.id)}
                        isPending={upsertMutation.isPending || deleteMutation.isPending}
                        mobileMode
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Summary footer ────────────────────────────────────────────── */}
        {selectedStore && !isLoading && activeEmployees.length > 0 && (
          <div className="sticky bottom-0 z-20 border-t bg-background shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] px-4 py-2.5">
            {/* Mobile: stacked layout */}
            <div className="flex flex-col gap-2 md:hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Week Summary</span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold" data-testid="text-total-hours-mobile">
                      {totalStoreHours.toFixed(1)} hrs
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Cost:</span>
                    <span className="text-sm font-bold text-primary" data-testid="text-total-cost-mobile">
                      ${totalStoreCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
              {activeEmployees.some(({ employee: emp }) => empHours(emp.id) > 0) && (
                <div className="flex gap-1.5 flex-wrap">
                  {activeEmployees.map(({ employee: emp }) => {
                    const hrs = empHours(emp.id);
                    if (hrs === 0) return null;
                    return (
                      <Badge key={emp.id} variant="secondary" className="text-[10px]">
                        {emp.nickname || emp.firstName}: {hrs.toFixed(1)}h
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Desktop: horizontal layout */}
            <div className="hidden md:flex items-center gap-6 text-sm">
              <span className="text-muted-foreground font-medium">Week Summary</span>
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium" data-testid="text-total-hours">
                  {totalStoreHours.toFixed(1)} hrs
                </span>
                <span className="text-muted-foreground text-xs">total</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Est. Wage Cost:</span>
                <span className="font-semibold text-primary" data-testid="text-total-cost">
                  ${totalStoreCost.toFixed(2)}
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex gap-2 flex-wrap">
                {activeEmployees.map(({ employee: emp }) => {
                  const hrs = empHours(emp.id);
                  if (hrs === 0) return null;
                  return (
                    <Badge key={emp.id} variant="secondary" className="text-xs" data-testid={`badge-emp-hours-${emp.id}`}>
                      {emp.nickname || emp.firstName}: {hrs.toFixed(1)}h
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
