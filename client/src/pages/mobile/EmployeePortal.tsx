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
  AlertCircle,
  Loader2,
  PenLine,
  Home,
  CalendarDays,
  Settings,
  LogOut,
  KeyRound,
  FileText,
  ChevronRight,
  User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "home" | "schedule" | "settings";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getTodayStr(): string { return toLocalDateStr(new Date()); }
function fmtLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long",
  });
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
  const handleDel = () => { setPin(p => p.slice(0, -1)); setError(""); };

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Staff Portal</h1>
        <p className="text-muted-foreground mt-2 text-sm">Enter your 4-digit PIN to continue</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-6" data-testid="pin-dots">
        {[0,1,2,3].map(i => (
          <div key={i} className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
            i < pin.length ? "bg-foreground border-foreground scale-110" : "border-muted-foreground/50"
          }`} />
        ))}
      </div>

      {/* Error */}
      <div className="w-full max-w-xs" style={{ minHeight: "40px" }}>
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-4 py-2.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {loginMutation.isPending && (
          <div className="flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-xs">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => (
          <button
            key={idx} type="button"
            disabled={loginMutation.isPending || key === ""}
            data-testid={key === "⌫" ? "pin-delete" : key ? `pin-digit-${key}` : undefined}
            className={`h-[72px] rounded-2xl text-2xl font-semibold transition-all select-none ${
              key === "" ? "invisible pointer-events-none" :
              "bg-muted hover-elevate active-elevate-2"
            } ${key === "⌫" ? "text-muted-foreground" : "text-foreground"}`}
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

  useEffect(() => {
    if (open) { setStartTime(shift.startTime); setEndTime(shift.endTime); setReason(""); }
  }, [open, shift.startTime, shift.endTime]);

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
      <DrawerContent className="px-4 max-w-md mx-auto">
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
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
  item, employeeId, onTimesheetChange,
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
          <div className="flex items-center gap-2 mb-3">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: item.storeColor }} />
            <span className="font-semibold text-sm">{item.storeName} Store</span>
          </div>
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-3xl font-bold tabular-nums tracking-tight" data-testid="text-shift-time">
                {shift.startTime} – {shift.endTime}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">{hours.toFixed(1)} hours</p>
            </div>
            <div className="h-12 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.storeColor }} />
          </div>
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

// ── Tab: Home ─────────────────────────────────────────────────────────────────

function HomeTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const [localTimesheets, setLocalTimesheets] = useState<Record<string, TimesheetInfo>>({});
  const qc = useQueryClient();
  const displayName = session.nickname || session.firstName;

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

  const todayShifts: TodayShiftItem[] = (todayData?.shifts ?? []).map(item => ({
    ...item,
    timesheet: localTimesheets[item.shift.storeId] ?? item.timesheet,
  }));

  return (
    <div className="flex flex-col gap-5 px-4 py-5">
      {/* Greeting */}
      <div>
        <p className="text-sm text-muted-foreground">Good {getGreeting()},</p>
        <h2 className="text-2xl font-bold" data-testid="text-employee-name">{displayName}</h2>
      </div>

      {/* TODAY section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <h3 className="font-semibold text-xs uppercase tracking-widest text-muted-foreground">
            Today · {fmtLongDate(today)}
          </h3>
        </div>

        {todayLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!todayLoading && todayShifts.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No shifts today</p>
              <p className="text-sm text-muted-foreground mt-1">You have no published shifts scheduled.</p>
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

      {/* Quick Actions */}
      <div>
        <h3 className="font-semibold text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Quick Actions
        </h3>
        <Card>
          <CardContent className="p-0">
            <button
              type="button"
              data-testid="button-daily-close-report"
              className="w-full flex items-center gap-4 px-4 py-4 hover-elevate active-elevate-2 rounded-md text-left"
              onClick={() => {}}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Submit Daily Close Report</p>
                <p className="text-xs text-muted-foreground mt-0.5">End-of-day summary for managers</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Tab: Schedule ─────────────────────────────────────────────────────────────

function ScheduleTab() {
  return (
    <div className="flex flex-col gap-5 px-4 py-5">
      <div>
        <h2 className="text-xl font-bold">My Upcoming Shifts</h2>
        <p className="text-sm text-muted-foreground mt-1">Your weekly schedule at a glance</p>
      </div>
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">Weekly schedule view coming soon.</p>
          <p className="text-xs text-muted-foreground text-center max-w-[200px]">
            Your full shift calendar will appear here once it's ready.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Settings ─────────────────────────────────────────────────────────────

function SettingsTab({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const displayName = session.nickname || session.firstName;

  return (
    <div className="flex flex-col gap-5 px-4 py-5">
      <div>
        <h2 className="text-xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage your account</p>
      </div>

      {/* User info card */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold" data-testid="text-settings-name">{displayName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Logged in as staff</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold px-1 mb-1">Account</p>
        <Card>
          <CardContent className="p-0">
            <button
              type="button"
              data-testid="button-change-pin"
              className="w-full flex items-center gap-4 px-4 py-4 hover-elevate active-elevate-2 rounded-md text-left"
              onClick={() => {}}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0">
                <KeyRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Change PIN</p>
                <p className="text-xs text-muted-foreground mt-0.5">Update your 4-digit access code</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Log out */}
      <div className="pt-2">
        <Button
          variant="destructive"
          className="w-full"
          onClick={onLogout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log Out
        </Button>
      </div>
    </div>
  );
}

// ── Bottom Navigation Bar ─────────────────────────────────────────────────────

const NAV_ITEMS: { tab: Tab; label: string; Icon: typeof Home }[] = [
  { tab: "home",     label: "Home",     Icon: Home },
  { tab: "schedule", label: "Schedule", Icon: CalendarDays },
  { tab: "settings", label: "Settings", Icon: Settings },
];

function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="sticky bottom-0 z-50 w-full border-t bg-background/95 backdrop-blur-sm">
      <div className="flex items-stretch h-16">
        {NAV_ITEMS.map(({ tab, label, Icon }) => {
          const isActive = active === tab;
          return (
            <button
              key={tab}
              type="button"
              data-testid={`nav-tab-${tab}`}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
              onClick={() => onChange(tab)}
            >
              <Icon
                className={`h-5 w-5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span className={`text-[10px] font-medium tracking-wide transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Logged-in App Shell ───────────────────────────────────────────────────────

function AppShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "home"     && <HomeTab session={session} />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "settings" && <SettingsTab session={session} onLogout={onLogout} />}
      </div>

      {/* Bottom nav */}
      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

export function EmployeePortal() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  useEffect(() => { saveSession(session); }, [session]);

  const handleLogout = () => setSession(null);
  const handleLogin  = (s: Session) => { saveSession(s); setSession(s); };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center">
      {/* Mobile-optimised shell: constrained width, full height */}
      <div className="w-full max-w-md flex flex-col min-h-screen border-x border-border/30">
        {/* Top bar — always visible */}
        <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b">
          <div className="flex items-center gap-2 px-4 h-12">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="font-semibold text-sm tracking-wide">Staff Portal</span>
          </div>
        </header>

        {/* Main content */}
        {session
          ? <AppShell session={session} onLogout={handleLogout} />
          : <div className="flex-1 flex flex-col">
              <PinLogin onSuccess={handleLogin} />
            </div>
        }
      </div>
    </div>
  );
}
