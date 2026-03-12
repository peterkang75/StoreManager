import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Clock,
  LogOut,
  ChevronRight,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  PenLine,
  CalendarDays,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalStore { id: string; name: string }
interface PortalEmployee { id: string; nickname: string | null; firstName: string; lastName: string }
interface Session { id: string; nickname: string | null; firstName: string; storeId: string | null; selectedStoreId: string }
interface ShiftInfo { id: string; startTime: string; endTime: string; date: string }
interface TimesheetInfo { id: string; actualStartTime: string; actualEndTime: string; status: string; adjustmentReason: string | null }
interface DayData { date: string; shift: ShiftInfo | null; timesheet: TimesheetInfo | null }
interface WeekData { days: DayData[]; published: boolean; weekStart: string; weekEnd: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getMondayStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function fmtWeekRange(start: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(start + "T00:00:00");
  e.setDate(e.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${s.toLocaleDateString("en-AU", opts)} – ${e.toLocaleDateString("en-AU", { ...opts, year: "numeric" })}`;
}

function fmtDay(dateStr: string): { abbr: string; num: string; full: string } {
  const d = new Date(dateStr + "T00:00:00");
  return {
    abbr: d.toLocaleDateString("en-AU", { weekday: "short" }),
    num: d.toLocaleDateString("en-AU", { day: "numeric" }),
    full: d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }),
  };
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

function gen15MinSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}
const TIME_SLOTS_15 = gen15MinSlots();

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// ── Session helpers ───────────────────────────────────────────────────────────

const SESSION_KEY = "ep_session_v2";

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.id || !s.selectedStoreId) return null;
    return s;
  } catch { return null; }
}

function saveSession(s: Session | null) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}

// ── Login Step 1: Store ───────────────────────────────────────────────────────

function StoreStep({ onSelect }: { onSelect: (s: PortalStore) => void }) {
  const { data: stores, isLoading } = useQuery<PortalStore[]>({
    queryKey: ["/api/portal/stores"],
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <h2 className="text-lg font-semibold">Select Your Store</h2>
        <p className="text-sm text-muted-foreground">Choose the store you work at</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {(stores ?? []).map(s => (
            <button key={s.id} type="button"
              className="w-full rounded-md border bg-card p-4 text-left hover-elevate active-elevate-2 flex items-center justify-between"
              data-testid={`portal-store-${s.name.toLowerCase()}`}
              onClick={() => onSelect(s)}
            >
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.name === "Sushi" ? "#16a34a" : "#dc2626" }} />
                <span className="font-medium">{s.name}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Login Step 2: Employee ────────────────────────────────────────────────────

function EmployeeStep({ store, onSelect, onBack }: { store: PortalStore; onSelect: (e: PortalEmployee) => void; onBack: () => void }) {
  const { data: employees, isLoading } = useQuery<PortalEmployee[]>({
    queryKey: ["/api/portal/employees", store.id],
    queryFn: async () => {
      const res = await fetch(`/api/portal/employees?storeId=${store.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <p className="text-xs text-muted-foreground mb-1">{store.name} Store</p>
        <h2 className="text-lg font-semibold">Who are you?</h2>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : employees?.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-6">No staff with PIN found for this store.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {(employees ?? []).map(e => (
            <button key={e.id} type="button"
              className="w-full rounded-md border bg-card p-3.5 text-left hover-elevate active-elevate-2 flex items-center justify-between"
              data-testid={`portal-emp-${e.id}`}
              onClick={() => onSelect(e)}
            >
              <span className="font-medium">{e.nickname || e.firstName}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onBack} className="mt-1">Back</Button>
    </div>
  );
}

// ── Login Step 3: PIN ─────────────────────────────────────────────────────────

function PinStep({ store, employee, onSuccess, onBack }: { store: PortalStore; employee: PortalEmployee; onSuccess: (s: Session) => void; onBack: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId: employee.id, pin: p }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Login failed"); }
      return res.json();
    },
    onSuccess: (data) => onSuccess({ ...data, selectedStoreId: store.id }),
    onError: (err: Error) => { setError(err.message); setPin(""); },
  });

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) setTimeout(() => loginMutation.mutate(next), 80);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <p className="text-xs text-muted-foreground mb-1">{store.name} · {employee.nickname || employee.firstName}</p>
        <h2 className="text-lg font-semibold">Enter your PIN</h2>
      </div>
      <div className="flex justify-center gap-4 py-2" data-testid="pin-dots">
        {[0,1,2,3].map(i => (
          <div key={i} className={`h-4 w-4 rounded-full border-2 transition-all ${i < pin.length ? "bg-foreground border-foreground" : "border-muted-foreground"}`} />
        ))}
      </div>
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      {loginMutation.isPending && <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      <div className="grid grid-cols-3 gap-2 mt-2">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => (
          <button key={idx} type="button"
            disabled={loginMutation.isPending || key === ""}
            data-testid={key === "⌫" ? "pin-delete" : key ? `pin-digit-${key}` : undefined}
            className={`h-14 rounded-md text-xl font-semibold transition-all ${key === "" ? "invisible" : "bg-muted hover-elevate active-elevate-2"} ${key === "⌫" ? "text-muted-foreground text-base" : ""}`}
            onClick={() => key === "⌫" ? setPin(p => p.slice(0, -1)) : handleDigit(key)}
          >{key}</button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onBack} disabled={loginMutation.isPending}>Back</Button>
    </div>
  );
}

// ── Modify / Confirm Drawer ───────────────────────────────────────────────────

function TimesheetDrawer({
  open, day, storeId, employeeId, onClose, onSubmitted,
}: {
  open: boolean; day: DayData; storeId: string; employeeId: string;
  onClose: () => void; onSubmitted: (ts: TimesheetInfo) => void;
}) {
  const { toast } = useToast();
  const shift = day.shift!;
  const [startTime, setStartTime] = useState(shift.startTime);
  const [endTime, setEndTime] = useState(shift.endTime);
  const [reason, setReason] = useState("");
  const isModified = startTime !== shift.startTime || endTime !== shift.endTime;
  const hours = calcHours(startTime, endTime);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portal/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId, employeeId, date: day.date,
          actualStartTime: startTime, actualEndTime: endTime,
          adjustmentReason: isModified ? reason : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Timesheet submitted", description: `${day.date} hours recorded.` });
      onSubmitted(data);
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canSubmit = !isModified || (reason.trim().length > 0 && hours > 0);

  return (
    <Drawer open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DrawerContent className="px-4">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Submit Timesheet — {fmtDay(day.date).full}</DrawerTitle>
          <p className="text-sm text-muted-foreground">Rostered: {shift.startTime} – {shift.endTime} ({calcHours(shift.startTime, shift.endTime).toFixed(1)}h)</p>
        </DrawerHeader>
        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-start">Actual Start</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="actual-start" data-testid="input-actual-start"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIME_SLOTS_15.map(t => <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-end">Actual End</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger id="actual-end" data-testid="input-actual-end"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIME_SLOTS_15.map(t => <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {hours > 0 && (
            <p className="text-sm text-center text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{hours.toFixed(1)}h</span>
              {isModified && <span className="ml-2 text-amber-600 dark:text-amber-400 text-xs">(modified)</span>}
            </p>
          )}
          {isModified && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">Reason for adjustment <span className="text-destructive">*</span></Label>
              <Textarea
                id="reason" data-testid="input-adjustment-reason"
                placeholder="e.g. Started 30 mins late due to traffic..."
                value={reason} onChange={e => setReason(e.target.value)}
                className="resize-none" rows={3}
              />
            </div>
          )}
          {!isModified && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              Hours match the roster — no reason needed
            </div>
          )}
        </div>
        <DrawerFooter className="pt-2">
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || hours <= 0 || submitMutation.isPending}
            data-testid="button-submit-timesheet"
          >
            {submitMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting…</>
              : isModified ? "Submit Modified Hours" : "Confirm Hours"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={submitMutation.isPending}>Cancel</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ── Day Row ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:  { bg: "bg-amber-100 dark:bg-amber-950",  text: "text-amber-800 dark:text-amber-300",  label: "Pending" },
  APPROVED: { bg: "bg-green-100 dark:bg-green-950",  text: "text-green-800 dark:text-green-300",  label: "Approved" },
  REJECTED: { bg: "bg-red-100 dark:bg-red-950",      text: "text-red-800 dark:text-red-300",      label: "Rejected" },
};

function DayRow({ day, today, onSubmit }: { day: DayData; today: string; onSubmit: (d: DayData) => void }) {
  const { abbr, num } = fmtDay(day.date);
  const isToday = day.date === today;
  const isPast = day.date < today;
  const canSubmit = (isToday || isPast) && !!day.shift && !day.timesheet;
  const st = day.timesheet ? STATUS_STYLE[day.timesheet.status] ?? STATUS_STYLE.PENDING : null;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-md transition-colors ${isToday ? "bg-primary/5 dark:bg-primary/10 ring-1 ring-primary/20" : ""}`}
      data-testid={`day-row-${day.date}`}
    >
      {/* Date label */}
      <div className={`flex flex-col items-center w-10 shrink-0 ${isToday ? "text-primary" : isPast ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
        <span className="text-[10px] font-medium uppercase tracking-wide">{abbr}</span>
        <span className={`text-lg font-bold leading-tight ${isToday ? "text-primary" : ""}`}>{num}</span>
      </div>

      {/* Shift info */}
      <div className="flex-1 min-w-0">
        {day.shift ? (
          <>
            <p className={`font-semibold text-sm tabular-nums ${isPast && !isToday ? "text-muted-foreground" : ""}`}>
              {day.shift.startTime} – {day.shift.endTime}
            </p>
            <p className="text-xs text-muted-foreground">{calcHours(day.shift.startTime, day.shift.endTime).toFixed(1)}h</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">No shift</p>
        )}
      </div>

      {/* Status / action */}
      <div className="shrink-0">
        {day.timesheet && st ? (
          <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
            <CheckCircle2 className={`h-3.5 w-3.5 ${st.text}`} />
            <span className={`text-xs font-medium ${st.text}`}>{st.label}</span>
          </div>
        ) : canSubmit ? (
          <Button size="sm" variant="outline" onClick={() => onSubmit(day)} data-testid={`button-submit-${day.date}`}>
            <PenLine className="h-3.5 w-3.5 mr-1" />
            Submit
          </Button>
        ) : day.shift && !isPast && !isToday ? (
          <span className="text-xs text-muted-foreground/40 pr-1">Upcoming</span>
        ) : null}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const today = getTodayStr();
  const [weekStart, setWeekStart] = useState(() => getMondayStr(today));
  const [activeDay, setActiveDay] = useState<DayData | null>(null);
  const [localUpdates, setLocalUpdates] = useState<Record<string, TimesheetInfo>>({});
  const qc = useQueryClient();

  const weekQK = ["/api/portal/week", session.id, session.selectedStoreId, weekStart];

  const { data: weekData, isLoading, error } = useQuery<WeekData>({
    queryKey: weekQK,
    queryFn: async () => {
      const res = await fetch(
        `/api/portal/week?employeeId=${session.id}&storeId=${session.selectedStoreId}&weekStart=${weekStart}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
  });

  const displayName = session.nickname || session.firstName;
  const isCurrentWeek = weekStart === getMondayStr(today);

  const days: DayData[] = (weekData?.days ?? []).map(d => ({
    ...d,
    timesheet: localUpdates[d.date] ?? d.timesheet,
  }));

  const totalShiftHours = days.reduce((sum, d) => d.shift ? sum + calcHours(d.shift.startTime, d.shift.endTime) : sum, 0);
  const submittedCount = days.filter(d => !!d.timesheet).length;
  const shiftCount = days.filter(d => !!d.shift).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good {getGreeting()},</p>
          <h2 className="text-xl font-bold" data-testid="text-employee-name">{displayName}</h2>
        </div>
        <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-logout" title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2">
        <Button size="icon" variant="ghost" onClick={() => setWeekStart(s => addDays(s, -7))} data-testid="button-prev-week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center flex-1">
          <p className="text-sm font-medium">{fmtWeekRange(weekStart)}</p>
          {isCurrentWeek && <p className="text-xs text-primary font-medium">This week</p>}
        </div>
        <Button size="icon" variant="ghost" onClick={() => setWeekStart(s => addDays(s, 7))} data-testid="button-next-week"
          disabled={isCurrentWeek}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Week summary bar */}
      {!isLoading && weekData && (
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{shiftCount} shifts · {totalShiftHours.toFixed(1)}h total</span>
          {shiftCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className={`h-3.5 w-3.5 ${submittedCount === shiftCount ? "text-green-600" : "text-amber-500"}`} />
              {submittedCount}/{shiftCount} submitted
            </span>
          )}
        </div>
      )}

      {/* Days list */}
      {isLoading && (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />Failed to load schedule. Please try again.
        </div>
      )}

      {!isLoading && !error && (
        <Card data-testid="card-week-schedule">
          <CardContent className="py-2 px-2">
            {!weekData?.published && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-3 mb-1">
                <Clock className="h-4 w-4 shrink-0" />
                Roster not yet published for this week
              </div>
            )}
            <div className="divide-y">
              {days.map(day => (
                <DayRow
                  key={day.date}
                  day={day}
                  today={today}
                  onSubmit={d => setActiveDay(d)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timesheet drawer */}
      {activeDay?.shift && (
        <TimesheetDrawer
          open={!!activeDay}
          day={activeDay}
          storeId={session.selectedStoreId}
          employeeId={session.id}
          onClose={() => setActiveDay(null)}
          onSubmitted={(ts) => {
            setLocalUpdates(prev => ({ ...prev, [activeDay.date]: ts }));
            qc.invalidateQueries({ queryKey: weekQK });
          }}
        />
      )}
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

type LoginStep = "store" | "employee" | "pin";

export function EmployeePortal() {
  const [step, setStep] = useState<LoginStep>("store");
  const [selectedStore, setSelectedStore] = useState<PortalStore | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<PortalEmployee | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());

  useEffect(() => { saveSession(session); }, [session]);

  const handleLogout = () => {
    setSession(null);
    setStep("store");
    setSelectedStore(null);
    setSelectedEmployee(null);
  };

  const accentColor = selectedStore?.name === "Sandwich" ? "#dc2626" : "#16a34a";
  const storeName = selectedStore ? `${selectedStore.name} Portal` : session ? "Staff Portal" : "Staff Portal";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-3 border-b flex items-center gap-2 sticky top-0 bg-background z-50">
        <div className="h-6 w-6 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
        <span className="font-semibold text-sm">{storeName}</span>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-6">
        <div className="w-full max-w-sm">
          {session ? (
            <Dashboard session={session} onLogout={handleLogout} />
          ) : (
            <div className="bg-card rounded-lg border p-5 shadow-sm">
              {step === "store" && (
                <StoreStep onSelect={s => { setSelectedStore(s); setStep("employee"); }} />
              )}
              {step === "employee" && selectedStore && (
                <EmployeeStep
                  store={selectedStore}
                  onSelect={e => { setSelectedEmployee(e); setStep("pin"); }}
                  onBack={() => setStep("store")}
                />
              )}
              {step === "pin" && selectedStore && selectedEmployee && (
                <PinStep
                  store={selectedStore}
                  employee={selectedEmployee}
                  onSuccess={s => { saveSession(s); setSession(s); }}
                  onBack={() => setStep("employee")}
                />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
