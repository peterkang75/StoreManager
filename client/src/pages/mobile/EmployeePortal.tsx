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
  ChevronLeft,
  User,
  Plus,
  AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "home" | "schedule" | "settings";

interface Session { id: string; nickname: string | null; firstName: string }

interface ShiftInfo {
  id: string; storeId: string; startTime: string; endTime: string; date: string;
}
interface TimesheetInfo {
  id: string; actualStartTime: string; actualEndTime: string;
  status: string; adjustmentReason: string | null; isUnscheduled?: boolean;
}
interface TodayShiftItem {
  shift: ShiftInfo;
  storeName: string;
  storeColor: string;
  timesheet: TimesheetInfo | null;
}
interface UnscheduledTimesheetItem {
  timesheet: TimesheetInfo;
  storeName: string;
  storeColor: string;
}
interface TodayData {
  date: string;
  shifts: TodayShiftItem[];
  unscheduledTimesheets: UnscheduledTimesheetItem[];
}
interface StoreOption { id: string; name: string; }

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
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}
function getMondayStr(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
}
function fmtLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long",
  });
}
function fmtWeekRange(start: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(start + "T00:00:00");
  e.setDate(e.getDate() + 6);
  return `${s.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
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
      <div
        data-testid={`card-shift-${item.shift.storeId}`}
        className="flex overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm"
      >
        {/* Left accent bar — store colour */}
        <div className="w-1.5 shrink-0" style={{ backgroundColor: item.storeColor }} />

        {/* Content */}
        <div className="flex-1 p-5">
          {/* Row 1: store name + status badge */}
          <div className="flex items-start justify-between gap-2 mb-4">
            <span className="font-semibold text-sm text-muted-foreground">{item.storeName} Store</span>
            {ts && st && (
              <div className={`flex items-center gap-1 rounded-md px-2 py-1 shrink-0 ${st.bg}`}>
                <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
                <span className={`text-[11px] font-semibold ${st.text}`}>{st.label}</span>
              </div>
            )}
          </div>

          {/* Time range */}
          <p className="text-3xl font-bold tabular-nums tracking-tight leading-none" data-testid="text-shift-time">
            {shift.startTime} – {shift.endTime}
          </p>
          <p className="text-sm text-muted-foreground mt-1.5">{hours.toFixed(1)} hours</p>

          {/* Adjustment reason memo block */}
          {ts?.adjustmentReason && (
            <div className="flex items-start gap-2 mt-4 bg-muted/50 rounded-lg px-3 py-2.5 border border-border/30">
              <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">{ts.adjustmentReason}</p>
            </div>
          )}

          {/* Submit button (only if no timesheet yet) */}
          {!ts && (
            <Button
              className="w-full mt-4"
              style={{ backgroundColor: item.storeColor, borderColor: item.storeColor, color: "white" }}
              onClick={() => setDrawerOpen(true)}
              data-testid={`button-submit-${shift.storeId}`}
            >
              <PenLine className="h-4 w-4 mr-2" />
              Submit Timesheet
            </Button>
          )}
        </div>
      </div>

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

// ── Unscheduled Shift Drawer ──────────────────────────────────────────────────

function UnscheduledShiftDrawer({
  open, employeeId, today, onClose, onSubmitted,
}: {
  open: boolean;
  employeeId: string;
  today: string;
  onClose: () => void;
  onSubmitted: (ts: UnscheduledTimesheetItem) => void;
}) {
  const { toast } = useToast();
  const [storeId, setStoreId] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");

  const { data: stores = [] } = useQuery<StoreOption[]>({
    queryKey: ["/api/portal/stores"],
    queryFn: async () => {
      const res = await fetch("/api/portal/stores", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stores");
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setStoreId(stores.length > 0 ? stores[0].id : "");
      setStartTime("09:00");
      setEndTime("17:00");
      setReason("");
    }
  }, [open, stores]);

  useEffect(() => {
    if (open && stores.length > 0 && !storeId) setStoreId(stores[0].id);
  }, [stores, open, storeId]);

  const hours = calcHours(startTime, endTime);
  const canSubmit = !!storeId && hours > 0 && reason.trim().length > 0;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portal/unscheduled-timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ storeId, employeeId, date: today, actualStartTime: startTime, actualEndTime: endTime, adjustmentReason: reason }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: (ts) => {
      const store = stores.find(s => s.id === ts.storeId);
      toast({ title: "Logged", description: "Unscheduled shift recorded — pending manager approval." });
      onSubmitted({
        timesheet: ts,
        storeName: store?.name ?? "Unknown",
        storeColor: store?.name === "Sushi" ? "#16a34a" : store?.name === "Sandwich" ? "#dc2626" : "#888",
      });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Log Unscheduled Shift
          </DrawerTitle>
          <p className="text-sm text-muted-foreground text-left">{today} · Hours will be pending manager approval</p>
        </DrawerHeader>

        <div className="flex flex-col gap-4 px-4 pb-2">
          {/* Store */}
          <div className="flex flex-col gap-1.5">
            <Label>Store worked at</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger data-testid="select-unscheduled-store">
                <SelectValue placeholder="Select store…" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Start / End time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start Time</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger data-testid="select-unscheduled-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End Time</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger data-testid="select-unscheduled-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hours > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Total: <span className="font-semibold text-foreground">{hours.toFixed(1)} hrs</span>
            </p>
          )}
          {hours <= 0 && startTime && endTime && (
            <p className="text-xs text-destructive">End time must be after start time</p>
          )}

          {/* Reason — required */}
          <div className="flex flex-col gap-1.5">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              data-testid="textarea-unscheduled-reason"
              placeholder="e.g. Covering for sick staff, called in by manager…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">Required — explain why you worked without a scheduled shift</p>
          </div>
        </div>

        <DrawerFooter className="pt-2">
          <Button
            data-testid="button-submit-unscheduled"
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
            className="w-full"
          >
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit for Approval
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={submitMutation.isPending}>Cancel</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ── Unscheduled Timesheet Card ────────────────────────────────────────────────

function UnscheduledTimesheetCard({ item }: { item: UnscheduledTimesheetItem }) {
  const { timesheet, storeName } = item;
  const st = STATUS_STYLE[timesheet.status] ?? STATUS_STYLE.PENDING;
  const hours = calcHours(timesheet.actualStartTime, timesheet.actualEndTime);

  return (
    <div
      data-testid={`card-unscheduled-${timesheet.id}`}
      className="flex overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm"
    >
      {/* Left accent bar — amber signals exception/unscheduled state */}
      <div className="w-1.5 shrink-0 bg-amber-500" />

      {/* Content */}
      <div className="flex-1 p-5">
        {/* Row 1: store name + badges */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <span className="font-semibold text-sm text-muted-foreground">{storeName} Store</span>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-white bg-amber-500 rounded-md px-2 py-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              Unscheduled
            </span>
            <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
              <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
              <span className={`text-[11px] font-semibold ${st.text}`}>{st.label}</span>
            </div>
          </div>
        </div>

        {/* Time range */}
        <p className="text-3xl font-bold tabular-nums tracking-tight leading-none">
          {timesheet.actualStartTime} – {timesheet.actualEndTime}
        </p>
        <p className="text-sm text-muted-foreground mt-1.5">{hours.toFixed(1)} hours</p>

        {/* Reason memo block */}
        {timesheet.adjustmentReason && (
          <div className="flex items-start gap-2 mt-4 bg-muted/50 rounded-lg px-3 py-2.5 border border-border/30">
            <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">{timesheet.adjustmentReason}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Home ─────────────────────────────────────────────────────────────────

function HomeTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const [localTimesheets, setLocalTimesheets] = useState<Record<string, TimesheetInfo>>({});
  const [localUnscheduled, setLocalUnscheduled] = useState<UnscheduledTimesheetItem[]>([]);
  const [unscheduledDrawerOpen, setUnscheduledDrawerOpen] = useState(false);
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

  // Merge server-returned unscheduled timesheets with any locally added ones (dedup by id)
  const serverUnscheduled = todayData?.unscheduledTimesheets ?? [];
  const serverIds = new Set(serverUnscheduled.map(u => u.timesheet.id));
  const allUnscheduled = [
    ...serverUnscheduled,
    ...localUnscheduled.filter(u => !serverIds.has(u.timesheet.id)),
  ];

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

        {/* No scheduled shift: prominent button */}
        {!todayLoading && todayShifts.length === 0 && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardContent className="py-6 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">No shifts today</p>
                <p className="text-sm text-muted-foreground mt-1">You have no published shifts scheduled.</p>
                <Button
                  data-testid="button-log-unscheduled-primary"
                  className="mt-4 gap-2"
                  onClick={() => setUnscheduledDrawerOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Log Unscheduled Shift
                </Button>
              </CardContent>
            </Card>
            {/* Unscheduled timesheet cards (already logged today) */}
            {allUnscheduled.map(u => (
              <UnscheduledTimesheetCard key={u.timesheet.id} item={u} />
            ))}
          </div>
        )}

        {/* Has scheduled shifts: show cards + secondary link */}
        {!todayLoading && todayShifts.length > 0 && (
          <div className="flex flex-col gap-4">
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
            {/* Unscheduled timesheets already logged today */}
            {allUnscheduled.map(u => (
              <UnscheduledTimesheetCard key={u.timesheet.id} item={u} />
            ))}
            {/* Secondary link to add an extra unscheduled shift */}
            <button
              type="button"
              data-testid="button-log-unscheduled-secondary"
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover-elevate active-elevate-2 rounded-md py-2 w-full"
              onClick={() => setUnscheduledDrawerOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add an extra / unscheduled shift
            </button>
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

      <UnscheduledShiftDrawer
        open={unscheduledDrawerOpen}
        employeeId={session.id}
        today={today}
        onClose={() => setUnscheduledDrawerOpen(false)}
        onSubmitted={(item) => {
          setLocalUnscheduled(prev => [item, ...prev]);
          qc.invalidateQueries({ queryKey: todayQK });
        }}
      />
    </div>
  );
}

// ── Week Row ──────────────────────────────────────────────────────────────────

function WeekRow({ day, today }: { day: DayData; today: string }) {
  const { abbr, num } = fmtDay(day.date);
  const isToday = day.date === today;
  const isPast  = day.date < today;
  const ts = day.timesheet;
  const st = ts ? STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING : null;

  return (
    <div className={`flex items-center gap-3 px-3 py-3 ${isToday ? "bg-primary/5 dark:bg-primary/10 rounded-md" : ""}`}>
      {/* Day label */}
      <div className={`flex flex-col items-center w-10 shrink-0 ${
        isToday ? "text-primary" : isPast ? "text-muted-foreground" : "text-muted-foreground/40"
      }`}>
        <span className="text-[10px] font-medium uppercase tracking-wide">{abbr}</span>
        <span className={`text-lg font-bold leading-tight ${isToday ? "text-primary" : ""}`}>{num}</span>
      </div>

      {/* Shift info */}
      <div className="flex-1 min-w-0">
        {day.shift ? (
          <>
            <p className={`font-semibold text-sm tabular-nums ${
              !isToday && isPast ? "text-muted-foreground" :
              !isToday && !isPast ? "text-muted-foreground/50" : ""
            }`}>
              {day.shift.startTime} – {day.shift.endTime}
            </p>
            <p className="text-xs text-muted-foreground">
              {calcHours(day.shift.startTime, day.shift.endTime).toFixed(1)}h
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">Day off</p>
        )}
      </div>

      {/* Timesheet badge */}
      <div className="shrink-0">
        {st && ts && (
          <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
            <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
            <span className={`text-xs font-medium ${st.text}`}>{st.label.split(" ")[0]}</span>
          </div>
        )}
        {day.shift && !ts && !isPast && (
          <span className="text-xs text-muted-foreground/40">–</span>
        )}
      </div>
    </div>
  );
}

// ── Tab: Schedule ─────────────────────────────────────────────────────────────

function ScheduleTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const [weekStart, setWeekStart] = useState(() => getMondayStr(today));
  const isCurrentWeek = weekStart === getMondayStr(today);

  const weekQK = ["/api/portal/week-all", session.id, weekStart];
  const { data: weekData, isLoading } = useQuery<WeekData>({
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

  const days = weekData?.days ?? [];
  const shiftDays   = days.filter(d => d.shift);
  const totalHours  = shiftDays.reduce((s, d) => s + calcHours(d.shift!.startTime, d.shift!.endTime), 0);
  const submitted   = days.filter(d => d.timesheet).length;

  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">My Schedule</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Your weekly shift roster</p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button
          size="icon" variant="ghost"
          onClick={() => setWeekStart(s => addDays(s, -7))}
          data-testid="button-prev-week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{fmtWeekRange(weekStart)}</span>
        <Button
          size="icon" variant="ghost"
          onClick={() => setWeekStart(s => addDays(s, 7))}
          disabled={isCurrentWeek}
          data-testid="button-next-week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary strip */}
      {!isLoading && weekData?.published && shiftDays.length > 0 && (
        <div className="flex items-center justify-between bg-muted/40 rounded-md px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{shiftDays.length}</span> shifts ·{" "}
            <span className="font-semibold text-foreground">{totalHours.toFixed(1)}h</span> total
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className={`h-3.5 w-3.5 ${submitted === shiftDays.length ? "text-green-600" : "text-amber-500"}`} />
            {submitted}/{shiftDays.length} submitted
          </span>
        </div>
      )}

      {/* Days list */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && !weekData?.published && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">Roster not published yet</p>
            <p className="text-xs text-muted-foreground">
              Check back once the manager publishes the week's roster.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && weekData?.published && (
        <Card>
          <CardContent className="py-2 px-1">
            <div className="divide-y">
              {days.map(day => <WeekRow key={day.date} day={day} today={today} />)}
            </div>
          </CardContent>
        </Card>
      )}
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
    <nav className="shrink-0 z-50 w-full border-t bg-background/95 backdrop-blur-sm">
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
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content area — fills available space between header and bottom nav */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "home"     && <HomeTab session={session} />}
        {activeTab === "schedule" && <ScheduleTab session={session} />}
        {activeTab === "settings" && <SettingsTab session={session} onLogout={onLogout} />}
      </div>

      {/* Bottom nav — always pinned to bottom because parent height is exact viewport */}
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
    <div className="h-screen overflow-hidden bg-background flex flex-col items-center">
      {/* Mobile-optimised shell: constrained width, exact viewport height */}
      <div className="w-full max-w-md h-full flex flex-col border-x border-border/30">
        {/* Top bar — always visible, never scrolls */}
        <header className="shrink-0 z-50 bg-background/95 backdrop-blur-sm border-b">
          <div className="flex items-center gap-2 px-4 h-12">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="font-semibold text-sm tracking-wide">Staff Portal</span>
          </div>
        </header>

        {/* Main content fills remaining height */}
        {session
          ? <AppShell session={session} onLogout={handleLogout} />
          : <div className="flex-1 flex flex-col overflow-y-auto">
              <PinLogin onSuccess={handleLogin} />
            </div>
        }
      </div>
    </div>
  );
}
