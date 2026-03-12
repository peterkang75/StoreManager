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
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  PenLine,
  CalendarDays,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session { id: string; nickname: string | null; firstName: string }

interface ShiftInfo {
  id: string; storeId: string; startTime: string; endTime: string; date: string;
}
interface TimesheetInfo {
  id: string; actualStartTime: string; actualEndTime: string;
  status: string; adjustmentReason: string | null;
}
interface TodayShiftItem {
  shift: ShiftInfo;
  storeName: string;
  storeColor: string;
  timesheet: TimesheetInfo | null;
}
interface TodayData { date: string; shifts: TodayShiftItem[] }

interface DayData { date: string; shift: ShiftInfo | null; timesheet: TimesheetInfo | null }
interface WeekData { days: DayData[]; published: boolean; weekStart: string; weekEnd: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getTodayStr(): string { return toLocalDateStr(new Date()); }
function getMondayStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}
function fmtLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function fmtWeekRange(start: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(start + "T00:00:00");
  e.setDate(e.getDate() + 6);
  return `${s.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}
function fmtDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    abbr: d.toLocaleDateString("en-AU", { weekday: "short" }),
    num: d.toLocaleDateString("en-AU", { day: "numeric" }),
  };
}
function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}
function gen15MinSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15)
    slots.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  return slots;
}
const TIME_SLOTS = gen15MinSlots();
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

// ── Session storage ───────────────────────────────────────────────────────────

const SESSION_KEY = "ep_session_v3";
function loadSession(): Session | null {
  try { const r = sessionStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveSession(s: Session | null) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:  { bg: "bg-amber-100 dark:bg-amber-950",  text: "text-amber-800 dark:text-amber-300",  label: "Pending Approval" },
  APPROVED: { bg: "bg-green-100 dark:bg-green-950",  text: "text-green-800 dark:text-green-300",  label: "Approved" },
  REJECTED: { bg: "bg-red-100 dark:bg-red-950",      text: "text-red-800 dark:text-red-300",      label: "Rejected" },
};

// ── 1-Step PIN Login ──────────────────────────────────────────────────────────

function PinLogin({ onSuccess }: { onSuccess: (s: Session) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await fetch("/api/portal/login-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin: p }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Invalid PIN"); }
      return res.json();
    },
    onSuccess: (data) => onSuccess({ id: data.id, nickname: data.nickname, firstName: data.firstName }),
    onError: (err: Error) => { setError(err.message); setPin(""); },
  });

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) setTimeout(() => loginMutation.mutate(next), 80);
  };
  const handleDel = () => setPin(p => p.slice(0, -1));

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xs mx-auto pt-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Staff Portal</h1>
        <p className="text-muted-foreground mt-1 text-sm">Enter your 4-digit PIN</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-5 py-2" data-testid="pin-dots">
        {[0,1,2,3].map(i => (
          <div key={i} className={`h-5 w-5 rounded-full border-2 transition-all duration-150 ${
            i < pin.length ? "bg-foreground border-foreground scale-110" : "border-muted-foreground"
          }`} />
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5 w-full">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loginMutation.isPending && (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => (
          <button
            key={idx} type="button"
            disabled={loginMutation.isPending || key === ""}
            data-testid={key === "⌫" ? "pin-delete" : key ? `pin-digit-${key}` : undefined}
            className={`h-16 rounded-xl text-2xl font-semibold transition-all ${
              key === "" ? "invisible" : "bg-muted hover-elevate active-elevate-2"
            } ${key === "⌫" ? "text-muted-foreground text-lg" : ""}`}
            onClick={() => key === "⌫" ? handleDel() : handleDigit(key)}
          >{key}</button>
        ))}
      </div>
    </div>
  );
}

// ── Timesheet Drawer ──────────────────────────────────────────────────────────

function TimesheetDrawer({
  open, item, employeeId, onClose, onSubmitted,
}: {
  open: boolean;
  item: TodayShiftItem;
  employeeId: string;
  onClose: () => void;
  onSubmitted: (ts: TimesheetInfo) => void;
}) {
  const { toast } = useToast();
  const shift = item.shift;
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
          storeId: shift.storeId,
          employeeId,
          date: shift.date,
          actualStartTime: startTime,
          actualEndTime: endTime,
          adjustmentReason: isModified ? reason : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Submitted", description: `${item.storeName} timesheet recorded.` });
      onSubmitted(data);
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canSubmit = hours > 0 && (!isModified || reason.trim().length > 0);

  return (
    <Drawer open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DrawerContent className="px-4">
        <DrawerHeader className="pb-2">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.storeColor }} />
            <DrawerTitle>{item.storeName} — Submit Timesheet</DrawerTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Rostered: {shift.startTime} – {shift.endTime} ({calcHours(shift.startTime, shift.endTime).toFixed(1)}h)
          </p>
        </DrawerHeader>

        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Actual Start</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger data-testid="input-actual-start"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Actual End</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger data-testid="input-actual-end"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hours > 0 && (
            <p className="text-sm text-center text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{hours.toFixed(1)}h</span>
              {isModified && <span className="ml-2 text-amber-600 dark:text-amber-400 text-xs">(modified from rostered)</span>}
            </p>
          )}

          {isModified ? (
            <div className="flex flex-col gap-1.5">
              <Label>Reason for adjustment <span className="text-destructive">*</span></Label>
              <Textarea
                data-testid="input-adjustment-reason"
                placeholder="e.g. Started 30 mins late due to traffic..."
                value={reason} onChange={e => setReason(e.target.value)}
                className="resize-none" rows={3}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Hours match the roster — no reason needed
            </div>
          )}
        </div>

        <DrawerFooter className="pt-2">
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
            style={{ backgroundColor: item.storeColor, borderColor: item.storeColor, color: "white" }}
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

// ── Today Shift Card ──────────────────────────────────────────────────────────

function TodayShiftCard({
  item,
  employeeId,
  onTimesheetChange,
}: {
  item: TodayShiftItem;
  employeeId: string;
  onTimesheetChange: (ts: TimesheetInfo) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shift = item.shift;
  const ts = item.timesheet;
  const st = ts ? STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING : null;
  const hours = calcHours(shift.startTime, shift.endTime);

  return (
    <>
      <Card data-testid={`card-shift-${item.shift.storeId}`}>
        <CardContent className="pt-4 pb-4">
          {/* Store header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: item.storeColor }} />
            <span className="font-semibold text-sm">{item.storeName} Store</span>
          </div>

          {/* Time + hours */}
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-3xl font-bold tabular-nums tracking-tight" data-testid="text-shift-time">
                {shift.startTime} – {shift.endTime}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">{hours.toFixed(1)} hours</p>
            </div>
            <div className="h-12 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.storeColor }} />
          </div>

          {/* Timesheet status or actions */}
          {ts && st ? (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2.5 ${st.bg}`}>
              <CheckCircle2 className={`h-4 w-4 shrink-0 ${st.text}`} />
              <div>
                <p className={`text-sm font-semibold ${st.text}`}>{st.label}</p>
                <p className={`text-xs opacity-80 mt-0.5 ${st.text}`}>
                  {ts.actualStartTime} – {ts.actualEndTime}
                  {ts.adjustmentReason && ` · "${ts.adjustmentReason}"`}
                </p>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              style={{ backgroundColor: item.storeColor, borderColor: item.storeColor, color: "white" }}
              onClick={() => setDrawerOpen(true)}
              data-testid={`button-submit-${shift.storeId}`}
            >
              <PenLine className="h-4 w-4 mr-2" />
              Submit Timesheet
            </Button>
          )}
        </CardContent>
      </Card>

      <TimesheetDrawer
        open={drawerOpen}
        item={item}
        employeeId={employeeId}
        onClose={() => setDrawerOpen(false)}
        onSubmitted={onTimesheetChange}
      />
    </>
  );
}

// ── Weekly Schedule Row ───────────────────────────────────────────────────────

function WeekRow({ day, today }: { day: DayData; today: string }) {
  const { abbr, num } = fmtDay(day.date);
  const isToday = day.date === today;
  const isPast = day.date < today;
  const ts = day.timesheet;
  const st = ts ? STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING : null;

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${isToday ? "bg-primary/5 dark:bg-primary/10 rounded-md" : ""}`}>
      <div className={`flex flex-col items-center w-10 shrink-0 ${isToday ? "text-primary" : isPast ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
        <span className="text-[10px] font-medium uppercase tracking-wide">{abbr}</span>
        <span className={`text-lg font-bold leading-tight ${isToday ? "text-primary" : ""}`}>{num}</span>
      </div>
      <div className="flex-1 min-w-0">
        {day.shift ? (
          <>
            <p className={`font-semibold text-sm tabular-nums ${!isToday && isPast ? "text-muted-foreground" : !isPast && !isToday ? "text-muted-foreground/50" : ""}`}>
              {day.shift.startTime} – {day.shift.endTime}
            </p>
            <p className="text-xs text-muted-foreground">{calcHours(day.shift.startTime, day.shift.endTime).toFixed(1)}h</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">No shift</p>
        )}
      </div>
      <div className="shrink-0">
        {st && ts && (
          <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
            <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
            <span className={`text-xs font-medium ${st.text}`}>{st.label.split(" ")[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const today = getTodayStr();
  const [weekStart, setWeekStart] = useState(() => getMondayStr(today));
  const [localTimesheets, setLocalTimesheets] = useState<Record<string, TimesheetInfo>>({});
  const qc = useQueryClient();
  const displayName = session.nickname || session.firstName;
  const isCurrentWeek = weekStart === getMondayStr(today);

  // Today's multi-store shifts
  const todayQK = ["/api/portal/today", session.id, today];
  const { data: todayData, isLoading: todayLoading } = useQuery<TodayData>({
    queryKey: todayQK,
    queryFn: async () => {
      const res = await fetch(`/api/portal/today?employeeId=${session.id}&date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
  });

  // Weekly schedule — no storeId filter, fetches across all stores
  const weekQK = ["/api/portal/week-all", session.id, weekStart];
  const { data: weekData, isLoading: weekLoading } = useQuery<WeekData>({
    queryKey: weekQK,
    queryFn: async () => {
      const res = await fetch(
        `/api/portal/week?employeeId=${session.id}&weekStart=${weekStart}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
  });

  const todayShifts: TodayShiftItem[] = (todayData?.shifts ?? []).map(item => ({
    ...item,
    timesheet: localTimesheets[item.shift.storeId] ?? item.timesheet,
  }));

  const weekDays = weekData?.days ?? [];
  const shiftCount = weekDays.filter(d => d.shift).length;
  const submittedCount = weekDays.filter(d => d.timesheet).length;
  const weekTotal = weekDays.reduce((s, d) => d.shift ? s + calcHours(d.shift.startTime, d.shift.endTime) : s, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good {getGreeting()},</p>
          <h2 className="text-2xl font-bold" data-testid="text-employee-name">{displayName}</h2>
        </div>
        <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-logout">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* TODAY section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Today · {fmtLongDate(today)}
          </h3>
        </div>

        {todayLoading && (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}

        {!todayLoading && todayShifts.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No shifts today</p>
              <p className="text-sm text-muted-foreground mt-1">You have no published shifts scheduled for today.</p>
            </CardContent>
          </Card>
        )}

        {!todayLoading && todayShifts.length > 0 && (
          <div className="flex flex-col gap-3">
            {todayShifts.map(item => (
              <TodayShiftCard
                key={item.shift.storeId}
                item={item}
                employeeId={session.id}
                onTimesheetChange={(ts) => {
                  setLocalTimesheets(prev => ({ ...prev, [item.shift.storeId]: ts }));
                  qc.invalidateQueries({ queryKey: todayQK });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* WEEKLY SCHEDULE section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />Week Schedule
          </h3>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setWeekStart(s => addDays(s, -7))} data-testid="button-prev-week">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground px-1">{fmtWeekRange(weekStart)}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setWeekStart(s => addDays(s, 7))} disabled={isCurrentWeek} data-testid="button-next-week">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Summary pill */}
        {!weekLoading && weekData && shiftCount > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-1.5 mb-2">
            <span>{shiftCount} shifts · {weekTotal.toFixed(1)}h</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className={`h-3 w-3 ${submittedCount === shiftCount ? "text-green-600" : "text-amber-500"}`} />
              {submittedCount}/{shiftCount} submitted
            </span>
          </div>
        )}

        {weekLoading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

        {!weekLoading && weekData && (
          <Card>
            <CardContent className="py-2 px-1">
              {!weekData.published && (
                <p className="text-sm text-muted-foreground text-center py-3">Roster not published for this week</p>
              )}
              <div className="divide-y">
                {weekDays.map(day => <WeekRow key={day.date} day={day} today={today} />)}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

export function EmployeePortal() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  useEffect(() => { saveSession(session); }, [session]);

  const handleLogout = () => setSession(null);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 py-3 border-b sticky top-0 bg-background z-50">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Staff Portal</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-sm">
          {session ? (
            <Dashboard session={session} onLogout={handleLogout} />
          ) : (
            <PinLogin onSuccess={s => { saveSession(s); setSession(s); }} />
          )}
        </div>
      </main>
    </div>
  );
}
