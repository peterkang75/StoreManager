import { useState, useEffect, useRef } from "react";
import sushimeLogo from "../../assets/sushime_logo.png";
import eatemLogo from "../../assets/eatem_logo.png";
import { useLocation } from "wouter";
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
import { Input } from "@/components/ui/input";
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
  Upload,
  Save,
  ArrowLeft,
  MapPin,
  Shield,
  CreditCard,
  Building2,
  X,
  Camera,
  ImagePlus,
  Mail,
  Phone,
  BadgeCheck,
  Megaphone,
  Globe,
  ListChecks,
  Banknote,
  ShoppingCart,
  Package,
  Trash2,
  CheckCheck,
  Search,
  LayoutDashboard,
} from "lucide-react";
import type { Notice, ShiftTimesheet, ShoppingItem, ActiveShoppingListItem, StorageItem, ActiveStorageListItem, StorageUnit } from "@shared/schema";
import { getPayrollCycleStart, getPayrollCycleEnd, shiftDate } from "@shared/payrollCycle";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "home" | "schedule" | "timesheets" | "settings";

interface Session { id: string; nickname: string | null; firstName: string; selfieUrl?: string | null; role?: string | null }

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

const SESSION_KEY = "ep_session_v4";
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
    onSuccess: (data) => onSuccess({ id: data.id, nickname: data.nickname, firstName: data.firstName, selfieUrl: data.selfieUrl ?? null, role: data.role ?? null }),
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
    <div className="flex flex-col items-center justify-between flex-1 px-4 py-8 gap-6">

      {/* Logos — horizontal row, no box */}
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex flex-row items-center justify-center gap-2 w-full">
          {/* Sushime circular logo */}
          <div className="relative overflow-hidden flex items-center justify-center h-28 w-28 shrink-0">
            <img
              src={sushimeLogo}
              alt="Sushime"
              className="absolute inset-0 w-full h-full object-contain"
              style={{ transform: "scale(2.8)", transformOrigin: "center" }}
              data-testid="img-logo-sushime"
            />
          </div>

          {/* Vertical divider */}
          <div className="h-16 w-px bg-border/40 shrink-0" />

          {/* Eat'em text logo */}
          <div className="relative overflow-hidden flex items-center justify-center h-20 w-40 shrink-0">
            <img
              src={eatemLogo}
              alt="Eat'em"
              className="absolute inset-0 w-full h-full object-contain"
              style={{ transform: "scale(1.9)", transformOrigin: "center" }}
              data-testid="img-logo-eatem"
            />
          </div>
        </div>

        {/* Welcome text */}
        <div className="text-center">
          <p className="font-semibold text-foreground text-[19px]">
            Welcome to the Eat'em &amp; Sushime
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Team Portal</p>
        </div>
      </div>

      {/* PIN entry section */}
      <div className="flex flex-col items-center gap-5 w-full max-w-xs">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Enter your 4-digit PIN to continue</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Default PIN: last 4 digits of your phone number</p>
        </div>

        {/* PIN dots */}
        <div className="flex gap-6" data-testid="pin-dots">
          {[0,1,2,3].map(i => (
            <div key={i} className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
              i < pin.length ? "bg-foreground border-foreground scale-110" : "border-muted-foreground/50"
            }`} />
          ))}
        </div>

        {/* Error / loading */}
        <div className="w-full" style={{ minHeight: "36px" }}>
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
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => (
          <button
            key={idx} type="button"
            disabled={loginMutation.isPending || key === ""}
            data-testid={key === "⌫" ? "pin-delete" : key ? `pin-digit-${key}` : undefined}
            className={`h-[68px] rounded-2xl text-2xl font-semibold transition-all select-none ${
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

// ── Shopping List ─────────────────────────────────────────────────────────────

type ActiveListEntry = ActiveShoppingListItem & { item: ShoppingItem };

const SHOPPING_CATEGORIES = [
  "Vegetables", "Fruit", "Meat & Seafood", "Dairy & Eggs", "Beverages",
  "Pantry & Dry Goods", "Frozen", "Bakery", "Cleaning & Supplies", "Other",
];

function groupByCat<T extends { item: ShoppingItem }>(entries: T[]): Record<string, T[]> {
  return entries.reduce<Record<string, T[]>>((acc, e) => {
    const cat = e.item.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(e);
    return acc;
  }, {});
}

function ShoppingListView({ storeId }: { storeId?: string | null }) {
  const qc = useQueryClient();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");

  const activeQK = ["/api/shopping/active", storeId ?? "all"];
  const catalogQK = ["/api/shopping/items", storeId ?? "all"];

  const { data: activeList = [], isLoading: listLoading } = useQuery<ActiveListEntry[]>({
    queryKey: activeQK,
    queryFn: async () => {
      const p = storeId ? `?storeId=${storeId}` : "";
      const res = await fetch(`/api/shopping/active${p}`);
      return res.ok ? res.json() : [];
    },
    staleTime: 0,
  });

  const { data: catalog = [] } = useQuery<ShoppingItem[]>({
    queryKey: catalogQK,
    queryFn: async () => {
      const p = storeId ? `?storeId=${storeId}` : "";
      const res = await fetch(`/api/shopping/items${p}`);
      return res.ok ? res.json() : [];
    },
  });

  const invalidateBoth = () => {
    qc.invalidateQueries({ queryKey: activeQK });
    qc.invalidateQueries({ queryKey: catalogQK });
  };

  const removeMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/shopping/active/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const addMutation = useMutation({
    mutationFn: (itemId: number) =>
      fetch("/api/shopping/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, storeId }),
      }).then(r => r.json()),
    onSuccess: invalidateBoth,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const itemRes = await fetch("/api/shopping/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newItemName.trim(), category: newItemCategory, storeId }),
      });
      const item = await itemRes.json();
      await fetch("/api/shopping/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, storeId }),
      });
    },
    onSuccess: () => {
      invalidateBoth();
      setNewItemName("");
      setNewItemCategory("");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/shopping/active${storeId ? `?storeId=${storeId}` : ""}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const grouped = groupByCat(activeList);
  const activeCategories = Object.keys(grouped).sort();
  const activeItemIds = new Set(activeList.map(e => e.itemId));

  const filteredCatalog = catalog
    .filter(i => i.name.toLowerCase().includes(catalogSearch.toLowerCase()))
    .sort((a, b) => (b.selectionCount ?? 0) - (a.selectionCount ?? 0));
  const catalogGrouped = filteredCatalog.reduce<Record<string, ShoppingItem[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i);
    return acc;
  }, {});
  const catalogCategories = Object.keys(catalogGrouped).sort();

  return (
    <div className="flex flex-col gap-4 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">Today's List</h3>
          <p className="text-xs text-muted-foreground">
            {activeList.length} item{activeList.length !== 1 ? "s" : ""}
          </p>
        </div>
        {activeList.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover-elevate rounded-md px-2 py-1"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            data-testid="button-clear-list"
          >
            <Trash2 className="h-4 w-4" />
            Clear all
          </button>
        )}
      </div>

      {listLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!listLoading && activeList.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <ShoppingCart className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">Your list is empty</p>
            <p className="text-sm text-muted-foreground mt-1">Tap "Add Items" to build today's shopping list.</p>
          </CardContent>
        </Card>
      )}

      {activeCategories.map(category => (
        <div key={category}>
          <div className="sticky top-0 bg-background/95 backdrop-blur-sm py-2 z-10">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{category}</p>
          </div>
          <div className="flex flex-col gap-2">
            {grouped[category].map(entry => (
              <button
                key={entry.id}
                type="button"
                data-testid={`button-check-item-${entry.id}`}
                onClick={() => removeMutation.mutate(entry.id)}
                disabled={removeMutation.isPending}
                className="flex items-center gap-4 min-h-[3.5rem] w-full px-4 py-3 rounded-xl border bg-card text-left hover-elevate active-elevate-2"
              >
                <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                <span className="text-base font-medium flex-1">{entry.item.name}</span>
                <CheckCheck className="h-4 w-4 text-muted-foreground/30 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}

      <Button
        className="w-full h-14 text-base gap-2 mt-2"
        onClick={() => setAddSheetOpen(true)}
        data-testid="button-open-add-items"
      >
        <Plus className="h-5 w-5" />
        Add Items
      </Button>

      {/* Add Items Drawer */}
      <Drawer open={addSheetOpen} onOpenChange={setAddSheetOpen}>
        <DrawerContent className="max-h-[92vh] flex flex-col">
          <DrawerHeader className="shrink-0">
            <DrawerTitle>Add Items</DrawerTitle>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4">
            <div className="relative mb-4 sticky top-0 bg-background pt-1 pb-2 z-10">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items…"
                className="pl-9"
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                data-testid="input-catalog-search"
              />
            </div>

            {catalogCategories.map(category => (
              <div key={category} className="mb-5">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{category}</p>
                <div className="flex flex-col gap-2">
                  {catalogGrouped[category].map(item => {
                    const inList = activeItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`button-catalog-item-${item.id}`}
                        onClick={() => !inList && addMutation.mutate(item.id)}
                        disabled={inList || addMutation.isPending}
                        className={`flex items-center gap-3 min-h-[3rem] w-full px-4 py-3 rounded-xl border text-left transition-all ${
                          inList
                            ? "bg-primary/10 border-primary/20 cursor-default"
                            : "bg-card hover-elevate active-elevate-2"
                        }`}
                      >
                        {inList
                          ? <CheckCheck className="h-4 w-4 text-primary shrink-0" />
                          : <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                        <span className="flex-1 font-medium text-sm">{item.name}</span>
                        {item.selectionCount > 0 && (
                          <span className="text-xs text-muted-foreground/60 tabular-nums">{item.selectionCount}×</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {catalog.length === 0 && !catalogSearch && (
              <p className="text-sm text-muted-foreground text-center py-4">No items in catalog yet. Create one below.</p>
            )}
            {catalog.length > 0 && filteredCatalog.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No items match "{catalogSearch}".</p>
            )}

            <div className="border-t mt-4 pt-4 pb-4">
              <p className="text-sm font-semibold mb-3">Create New Item</p>
              <div className="flex flex-col gap-3">
                <Input
                  placeholder="Item name"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  data-testid="input-new-item-name"
                />
                <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                  <SelectTrigger data-testid="select-new-item-category">
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOPPING_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  disabled={!newItemName.trim() || !newItemCategory || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                  data-testid="button-create-new-item"
                >
                  {createMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Plus className="h-4 w-4 mr-2" />}
                  Add to List
                </Button>
              </div>
            </div>
          </div>

          <DrawerFooter className="shrink-0">
            <Button variant="outline" onClick={() => setAddSheetOpen(false)}>Done</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// ── Storage List ──────────────────────────────────────────────────────────────

type ActiveStorageEntry = ActiveStorageListItem & { item: StorageItem };

const STORAGE_CATEGORIES = [
  "Dry Goods", "Refrigerated", "Frozen", "Produce", "Beverages",
  "Sauces & Condiments", "Packaging", "Cleaning", "Other",
];

function StorageListView({ storeId, employeeName }: { storeId?: string | null; employeeName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [checkSheetOpen, setCheckSheetOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null);
  const [stockValue, setStockValue] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newUnit, setNewUnit] = useState<string>("ea");

  const catalogQK = ["/api/storage/items", storeId ?? "all"];
  const activeQK = ["/api/storage/active", storeId ?? "all"];
  const { data: storageUnits = [] } = useQuery<StorageUnit[]>({ queryKey: ["/api/storage/units"] });

  const { data: catalog = [], isLoading: catalogLoading } = useQuery<StorageItem[]>({
    queryKey: catalogQK,
    queryFn: async () => {
      const p = storeId ? `?storeId=${storeId}` : "";
      const res = await fetch(`/api/storage/items${p}`);
      return res.ok ? res.json() : [];
    },
  });

  const { data: activeList = [] } = useQuery<ActiveStorageEntry[]>({
    queryKey: activeQK,
    queryFn: async () => {
      const p = storeId ? `?storeId=${storeId}` : "";
      const res = await fetch(`/api/storage/active${p}`);
      return res.ok ? res.json() : [];
    },
    staleTime: 0,
  });

  const invalidateBoth = () => {
    qc.invalidateQueries({ queryKey: catalogQK });
    qc.invalidateQueries({ queryKey: activeQK });
  };

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, currentStock }: { id: number; currentStock: number }) => {
      const res = await fetch(`/api/storage/items/${id}/stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStock, checkedBy: employeeName }),
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateBoth();
      setCheckSheetOpen(false);
      setSelectedItem(null);
      setStockValue("");
      toast({ title: "Stock updated" });
    },
  });

  const addToActiveMutation = useMutation({
    mutationFn: (itemId: number) =>
      fetch("/api/storage/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, storeId, addedBy: employeeName }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const removeFromActiveMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/storage/active/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const createItemMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/storage/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), category: newCategory, unit: newUnit, storeId }),
      });
      return res.json();
    },
    onSuccess: (item) => {
      invalidateBoth();
      addToActiveMutation.mutate(item.id);
      setNewName("");
      setNewCategory("");
      setNewUnit("ea");
      setAddItemOpen(false);
      toast({ title: "Item added" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/storage/active${storeId ? `?storeId=${storeId}` : ""}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const activeItemIds = new Set(activeList.map(e => e.itemId));

  const catalogByCategory = catalog.reduce<Record<string, StorageItem[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i);
    return acc;
  }, {});
  const catalogCategories = Object.keys(catalogByCategory).sort();

  const pendingByCategory = activeList.reduce<Record<string, ActiveStorageEntry[]>>((acc, e) => {
    const cat = e.item.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(e);
    return acc;
  }, {});
  const pendingCategories = Object.keys(pendingByCategory).sort();

  return (
    <div className="flex flex-col gap-4 pb-32">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">Storage Check</h3>
          <p className="text-xs text-muted-foreground">
            {activeList.length} item{activeList.length !== 1 ? "s" : ""} to fetch
          </p>
        </div>
        {activeList.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover-elevate rounded-md px-2 py-1"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            data-testid="button-clear-storage-list"
          >
            <Trash2 className="h-4 w-4" />
            Clear all
          </button>
        )}
      </div>

      {activeList.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">Nothing to fetch</p>
            <p className="text-sm text-muted-foreground mt-1">Add items from the catalogue below.</p>
          </CardContent>
        </Card>
      )}

      {pendingCategories.map(cat => (
        <div key={cat}>
          <div className="sticky top-0 bg-background/95 backdrop-blur-sm py-2 z-10">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{cat}</p>
          </div>
          <div className="flex flex-col gap-2">
            {pendingByCategory[cat].map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-3 min-h-[3.5rem] px-4 py-3 rounded-xl border bg-card"
              >
                <button
                  type="button"
                  data-testid={`button-fetch-storage-${entry.id}`}
                  onClick={() => removeFromActiveMutation.mutate(entry.id)}
                  disabled={removeFromActiveMutation.isPending}
                  className="h-6 w-6 rounded-full border-2 border-amber-500/60 shrink-0 flex items-center justify-center hover-elevate"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-base font-medium">{entry.item.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground/70 font-normal">{entry.item.unit ?? "ea"}</span>
                </div>
                <button
                  type="button"
                  data-testid={`button-check-stock-${entry.id}`}
                  onClick={() => {
                    setSelectedItem(entry.item);
                    setStockValue(entry.item.currentStock !== null ? String(entry.item.currentStock) : "");
                    setCheckSheetOpen(true);
                  }}
                  className="text-xs text-amber-600 dark:text-amber-400 font-medium px-2 py-1 rounded-md hover-elevate shrink-0"
                >
                  Log stock
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Button
        className="w-full h-14 text-base gap-2 mt-2 bg-amber-500 hover:bg-amber-500 border-amber-600"
        variant="default"
        onClick={() => setAddItemOpen(true)}
        data-testid="button-open-add-storage"
      >
        <Plus className="h-5 w-5" />
        Add Items
      </Button>

      {/* Catalogue Drawer */}
      <Drawer open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DrawerContent className="max-h-[92vh] flex flex-col">
          <DrawerHeader className="shrink-0">
            <DrawerTitle>Storage Catalogue</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4">
            {catalogLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {catalogCategories.map(cat => (
              <div key={cat} className="mb-5">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{cat}</p>
                <div className="flex flex-col gap-2">
                  {catalogByCategory[cat].map(item => {
                    const inList = activeItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`button-storage-catalog-${item.id}`}
                        onClick={() => !inList && addToActiveMutation.mutate(item.id)}
                        disabled={inList || addToActiveMutation.isPending}
                        className={`flex items-center gap-3 min-h-[3rem] w-full px-4 py-3 rounded-xl border text-left ${
                          inList ? "bg-amber-500/10 border-amber-500/20 cursor-default" : "bg-card hover-elevate active-elevate-2"
                        }`}
                      >
                        {inList
                          ? <CheckCheck className="h-4 w-4 text-amber-500 shrink-0" />
                          : <Plus className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="flex-1 font-medium text-sm">{item.name}</span>
                        <span className="text-xs text-muted-foreground/60">{item.unit}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {catalog.length === 0 && !catalogLoading && (
              <p className="text-sm text-muted-foreground text-center py-4">No items in catalogue yet. Create one below.</p>
            )}

            <div className="border-t mt-4 pt-4 pb-4">
              <p className="text-sm font-semibold mb-3">Create New Item</p>
              <div className="flex flex-col gap-3">
                <Input
                  placeholder="Item name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  data-testid="input-storage-new-name"
                />
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger data-testid="select-storage-category">
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {STORAGE_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={newUnit} onValueChange={setNewUnit}>
                  <SelectTrigger data-testid="select-storage-unit">
                    <SelectValue placeholder="Unit…" />
                  </SelectTrigger>
                  <SelectContent>
                    {storageUnits.map(u => (
                      <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  disabled={!newName.trim() || !newCategory || createItemMutation.isPending}
                  onClick={() => createItemMutation.mutate()}
                  data-testid="button-create-storage-item"
                >
                  {createItemMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Plus className="h-4 w-4 mr-2" />}
                  Add to List
                </Button>
              </div>
            </div>
          </div>
          <DrawerFooter className="shrink-0">
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>Done</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Log Stock Drawer */}
      <Drawer open={checkSheetOpen} onOpenChange={setCheckSheetOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Log Stock — {selectedItem?.name}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 py-4 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">How many left?</p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={stockValue}
                onChange={e => setStockValue(e.target.value)}
                data-testid="input-stock-value"
                className="flex-1"
              />
              <span className="text-sm font-medium text-muted-foreground shrink-0 min-w-[2.5rem]">
                {selectedItem?.unit ?? "ea"}
              </span>
            </div>
          </div>
          <DrawerFooter>
            <Button
              className="w-full bg-amber-500 hover:bg-amber-500 border-amber-600"
              disabled={!stockValue || updateStockMutation.isPending}
              onClick={() => {
                if (selectedItem) updateStockMutation.mutate({ id: selectedItem.id, currentStock: Number(stockValue) });
              }}
              data-testid="button-submit-stock"
            >
              {updateStockMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setCheckSheetOpen(false)}>Cancel</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// ── Tab: Home ─────────────────────────────────────────────────────────────────

type HomeSubTab = "myDay" | "shopping" | "storage";

function HomeTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const [, navigate] = useLocation();
  const [localTimesheets, setLocalTimesheets] = useState<Record<string, TimesheetInfo>>({});
  const [localUnscheduled, setLocalUnscheduled] = useState<UnscheduledTimesheetItem[]>([]);
  const [unscheduledDrawerOpen, setUnscheduledDrawerOpen] = useState(false);
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>("myDay");
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

  const { data: employeeProfile } = useQuery<{ storeId?: string }>({
    queryKey: ["/api/employees", session.id],
    queryFn: () => fetch(`/api/employees/${session.id}`).then(r => r.ok ? r.json() : {}),
    staleTime: 60_000,
  });

  const { data: portalNotices = [] } = useQuery<Notice[]>({
    queryKey: ["/api/notices", "portal", employeeProfile?.storeId],
    queryFn: async () => {
      const params = new URLSearchParams({ activeOnly: "true" });
      if (employeeProfile?.storeId) params.set("storeId", employeeProfile.storeId);
      const res = await fetch(`/api/notices?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: true,
    staleTime: 120_000,
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
        {(session.role?.toUpperCase() === "OWNER" || session.role?.toUpperCase() === "MANAGER") && (
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { window.location.href = "/admin"; }}
              data-testid="button-admin-dashboard"
            >
              <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
              Admin Dashboard
            </Button>
          </div>
        )}
      </div>

      {/* Sub-tab row */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {([
          { id: "myDay", label: "My Day", icon: Home },
          { id: "shopping", label: "Shopping", icon: ShoppingCart },
          { id: "storage", label: "Storage", icon: Package },
        ] as { id: HomeSubTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`button-home-subtab-${id}`}
            onClick={() => setHomeSubTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              homeSubTab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover-elevate"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Shopping List tab */}
      {homeSubTab === "shopping" && (
        <ShoppingListView storeId={employeeProfile?.storeId ?? null} />
      )}

      {/* Storage tab */}
      {homeSubTab === "storage" && (
        <StorageListView storeId={employeeProfile?.storeId ?? null} employeeName={displayName} />
      )}

      {/* My Day section */}
      {homeSubTab === "myDay" && (
      <><div>
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
              onClick={() => navigate("/m/daily-close")}
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

      {/* Notices */}
      {portalNotices.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="font-semibold text-xs uppercase tracking-widest text-muted-foreground">
              Notices
            </h3>
          </div>
          <div className="flex flex-col gap-3">
            {portalNotices.map(n => (
              <Card key={n.id} data-testid={`card-portal-notice-${n.id}`}>
                <CardContent className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <p className="font-semibold text-sm leading-tight">{n.title}</p>
                    {!n.targetStoreId && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="w-3 h-3" /> All Stores
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {n.content}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
      </>)}

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

function PastShiftTimesheetDrawer({
  open, employeeId, day, onClose, onSubmitted,
}: {
  open: boolean;
  employeeId: string;
  day: DayData;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const shift = day.shift!;
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
          date: day.date,
          actualStartTime: startTime,
          actualEndTime: endTime,
          adjustmentReason: isModified ? reason : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Submitted", description: `Timesheet for ${day.date} recorded.` });
      onSubmitted();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canSubmit = hours > 0 && (!isModified || reason.trim().length > 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 shrink-0">
          <div>
            <h3 className="font-semibold text-base">Submit Timesheet</h3>
            <p className="text-xs text-muted-foreground">{day.date} · Rostered {shift.startTime} – {shift.endTime}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Start Time</label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="h-11 text-sm" data-testid="input-past-start" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">End Time</label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="h-11 text-sm" data-testid="input-past-end" />
            </div>
          </div>
          {isModified && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Reason for change <span className="text-destructive">*</span></label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Left early with manager approval" rows={3} className="resize-none text-sm" data-testid="textarea-past-reason" />
            </div>
          )}
          <div className="bg-muted/40 rounded-md px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total hours</span>
            <span className="font-bold text-lg">{hours.toFixed(1)}h</span>
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border/40 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitMutation.isPending}>Cancel</Button>
          <Button className="flex-[2]" onClick={() => submitMutation.mutate()} disabled={!canSubmit || submitMutation.isPending} data-testid="button-past-submit">
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PenLine className="h-4 w-4 mr-2" />}
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function WeekRow({ day, today, employeeId, onSubmitted, openCycleStart }: { day: DayData; today: string; employeeId: string; onSubmitted: () => void; openCycleStart: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { abbr, num } = fmtDay(day.date);
  const isToday = day.date === today;
  const isPast  = day.date < today;
  const ts = day.timesheet;
  const st = ts ? STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING : null;
  // Allow logging only for past days within the current open payroll cycle.
  // Once the cycle ends (every 2 Sundays), the window closes.
  const canLogPast = isPast && !!day.shift && !ts && day.date >= openCycleStart;

  return (
    <>
      <div
        className={`flex items-center gap-3 px-3 py-3 ${isToday ? "bg-primary/5 dark:bg-primary/10 rounded-md" : ""} ${canLogPast ? "cursor-pointer hover-elevate rounded-md" : ""}`}
        onClick={canLogPast ? () => setDrawerOpen(true) : undefined}
        data-testid={canLogPast ? `row-log-past-${day.date}` : undefined}
      >
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

        {/* Timesheet badge / Log prompt */}
        <div className="shrink-0">
          {st && ts && (
            <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
              <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
              <span className={`text-xs font-medium ${st.text}`}>{st.label.split(" ")[0]}</span>
            </div>
          )}
          {canLogPast && (
            <span className="text-xs text-primary font-medium">Log</span>
          )}
          {day.shift && !ts && !isPast && (
            <span className="text-xs text-muted-foreground/40">–</span>
          )}
        </div>
      </div>

      {canLogPast && (
        <PastShiftTimesheetDrawer
          open={drawerOpen}
          employeeId={employeeId}
          day={day}
          onClose={() => setDrawerOpen(false)}
          onSubmitted={onSubmitted}
        />
      )}
    </>
  );
}

// ── Tab: Schedule ─────────────────────────────────────────────────────────────

function ScheduleTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const [weekStart, setWeekStart] = useState(() => getMondayStr(today));
  const isCurrentWeek = weekStart === getMondayStr(today);
  const openCycleStart = getPayrollCycleStart(today); // start of current open payroll cycle
  const qc = useQueryClient();

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
              {days.map(day => (
                <WeekRow
                  key={day.date}
                  day={day}
                  today={today}
                  employeeId={session.id}
                  onSubmitted={() => qc.invalidateQueries({ queryKey: weekQK })}
                  openCycleStart={openCycleStart}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Timesheets ────────────────────────────────────────────────────────────

type HistoryEntry = {
  date: string;
  shift: { storeId: string; startTime: string; endTime: string } | null;
  timesheet: ShiftTimesheet | null;
};
type HistoryCycle = {
  cycleStart: string;
  cycleEnd: string;
  cycleStatus: "PAID" | "APPROVED" | "PENDING";
  payrollId: string | null;
  entries: HistoryEntry[];
};

const CYCLE_STATUS_STYLE = {
  PENDING:  { bg: "bg-amber-100 dark:bg-amber-950",  text: "text-amber-800 dark:text-amber-300",  label: "Pending" },
  APPROVED: { bg: "bg-blue-100 dark:bg-blue-950",    text: "text-blue-800 dark:text-blue-300",    label: "Approved" },
  PAID:     { bg: "bg-green-100 dark:bg-green-950",  text: "text-green-800 dark:text-green-300",  label: "Paid" },
};

function fmtCycleRange(start: string, end: string): string {
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function TimesheetsTab({ session }: { session: Session }) {
  const today = getTodayStr();
  const qc = useQueryClient();
  const [drawerDay, setDrawerDay] = useState<DayData | null>(null);

  const historyQK = ["/api/portal/history", session.id];
  const { data: cycles = [], isLoading } = useQuery<HistoryCycle[]>({
    queryKey: historyQK,
    queryFn: async () => {
      const res = await fetch(`/api/portal/history?employeeId=${session.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
  });

  // Stores for color lookup
  const { data: storeList = [] } = useQuery<StoreOption[]>({
    queryKey: ["/api/portal/stores"],
    queryFn: async () => {
      const res = await fetch("/api/portal/stores", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stores");
      return res.json();
    },
    staleTime: 300_000,
  });
  const storeColorOf = (storeId: string): string => {
    const name = storeList.find(s => s.id === storeId)?.name ?? "";
    return name === "Sushi" ? "#16a34a" : name === "Sandwich" ? "#dc2626" : "#888";
  };

  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-8">
      <div>
        <h2 className="text-xl font-bold">My Timesheets</h2>
        <p className="text-xs text-muted-foreground mt-0.5">History by pay cycle</p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1].map(i => (
            <Card key={i}><CardContent className="py-4 px-4">
              <div className="h-4 bg-muted rounded animate-pulse w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
            </CardContent></Card>
          ))}
        </div>
      )}

      {!isLoading && cycles.length === 0 && (
        <Card><CardContent className="py-8 flex flex-col items-center gap-2 text-center">
          <ListChecks className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No timesheet history yet.</p>
        </CardContent></Card>
      )}

      {cycles.map(cycle => {
        const ss = CYCLE_STATUS_STYLE[cycle.cycleStatus];
        const rangeStr = fmtCycleRange(cycle.cycleStart, cycle.cycleEnd);

        // PAID: show compact summary only
        if (cycle.cycleStatus === "PAID") {
          return (
            <Card key={cycle.cycleStart} data-testid={`card-cycle-paid-${cycle.cycleStart}`}>
              <CardContent className="px-4 py-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <p className="font-semibold text-sm">{rangeStr}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${ss.bg} ${ss.text}`}>
                    {ss.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Payroll for this period has been finalized and paid.
                </p>
              </CardContent>
            </Card>
          );
        }

        // PENDING / APPROVED: show per-day entries
        const canSubmit = cycle.cycleStatus === "PENDING";
        const totalShifts = cycle.entries.filter(e => e.shift).length;
        const submitted = cycle.entries.filter(e => e.timesheet).length;

        return (
          <Card key={cycle.cycleStart} data-testid={`card-cycle-${cycle.cycleStart}`}>
            <CardContent className="p-0">
              {/* Cycle header */}
              <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-3.5 border-b border-border/50">
                <div>
                  <p className="font-semibold text-sm">{rangeStr}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {submitted}/{totalShifts} submitted
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${ss.bg} ${ss.text}`}>
                  {ss.label}
                </span>
              </div>

              {/* Per-day entries */}
              <div className="divide-y divide-border/40">
                {cycle.entries.map(entry => {
                  const { abbr, num } = fmtDay(entry.date);
                  const color = entry.shift ? storeColorOf(entry.shift.storeId) : "#888";
                  const ts = entry.timesheet;
                  const tsSt = ts ? (STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING) : null;
                  const unsubmitted = canSubmit && !!entry.shift && !ts && entry.date < today;

                  const rowContent = (
                    <>
                      {/* Date */}
                      <div className="flex flex-col items-center w-9 shrink-0">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{abbr}</span>
                        <span className="text-base font-bold leading-tight" style={{ color }}>{num}</span>
                      </div>

                      {/* Shift info */}
                      <div className="flex-1 min-w-0">
                        {entry.shift && (
                          <p className="text-xs text-muted-foreground">
                            Rostered: {entry.shift.startTime} – {entry.shift.endTime}
                          </p>
                        )}
                        {ts ? (
                          <p className="font-semibold text-sm">{ts.actualStartTime} – {ts.actualEndTime}
                            <span className="text-muted-foreground font-normal ml-1">
                              ({calcHours(ts.actualStartTime, ts.actualEndTime).toFixed(1)}h)
                            </span>
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">
                            {unsubmitted ? "Tap to submit" : entry.shift ? "Not submitted" : "Unscheduled"}
                          </p>
                        )}
                      </div>

                      {/* Status */}
                      {tsSt && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${tsSt.bg} ${tsSt.text}`}>
                          {tsSt.label}
                        </span>
                      )}
                      {unsubmitted && <ChevronRight className="h-4 w-4 text-amber-500 shrink-0" />}
                    </>
                  );

                  if (unsubmitted) {
                    const dayData: DayData = {
                      date: entry.date,
                      shift: { id: entry.date, storeId: entry.shift!.storeId, startTime: entry.shift!.startTime, endTime: entry.shift!.endTime, date: entry.date },
                      timesheet: null,
                    };
                    return (
                      <button
                        key={entry.date}
                        type="button"
                        data-testid={`button-submit-entry-${entry.date}`}
                        className="w-full flex items-center gap-3 px-4 py-3 hover-elevate active-elevate-2 text-left"
                        onClick={() => setDrawerDay(dayData)}
                      >
                        {rowContent}
                      </button>
                    );
                  }

                  return (
                    <div key={entry.date} className="flex items-center gap-3 px-4 py-3">
                      {rowContent}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {drawerDay && (
        <PastShiftTimesheetDrawer
          open={!!drawerDay}
          employeeId={session.id}
          day={drawerDay}
          onClose={() => setDrawerDay(null)}
          onSubmitted={() => qc.invalidateQueries({ queryKey: historyQK })}
        />
      )}
    </div>
  );
}

// ── Edit Profile View ─────────────────────────────────────────────────────────

interface ProfileFormData {
  email: string;
  streetAddress: string;
  streetAddress2: string;
  suburb: string;
  state: string;
  postCode: string;
  selfieUrl: string;
  passportUrl: string;
  fhc: string;
  tfn: string;
  bsb: string;
  accountNo: string;
  superCompany: string;
  superMembershipNo: string;
}

function EditProfileView({ session, onBack }: { session: Session; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // File input refs
  const fhcFileRef = useRef<HTMLInputElement>(null);
  const selfieFileRef = useRef<HTMLInputElement>(null);
  const selfieCamRef = useRef<HTMLInputElement>(null);
  const passportFileRef = useRef<HTMLInputElement>(null);
  const passportCamRef = useRef<HTMLInputElement>(null);

  const [fhcUploading, setFhcUploading] = useState(false);
  const [selfieUploading, setSelfieUploading] = useState(false);
  const [passportUploading, setPassportUploading] = useState(false);

  const { data: employee, isLoading } = useQuery<any>({
    queryKey: ["/api/employees", session.id],
    queryFn: () => fetch(`/api/employees/${session.id}`).then(r => r.json()),
    staleTime: 0,
  });

  const [form, setForm] = useState<ProfileFormData>({
    email: "", streetAddress: "", streetAddress2: "", suburb: "", state: "", postCode: "",
    selfieUrl: "", passportUrl: "", fhc: "", tfn: "", bsb: "", accountNo: "",
    superCompany: "", superMembershipNo: "",
  });
  const [bsbError, setBsbError] = useState("");

  useEffect(() => {
    if (employee) {
      setForm({
        email: employee.email ?? "",
        streetAddress: employee.streetAddress ?? "",
        streetAddress2: employee.streetAddress2 ?? "",
        suburb: employee.suburb ?? "",
        state: employee.state ?? "",
        postCode: employee.postCode ?? "",
        selfieUrl: employee.selfieUrl ?? "",
        passportUrl: employee.passportUrl ?? "",
        fhc: employee.fhc ?? "",
        tfn: employee.tfn ?? "",
        bsb: employee.bsb ?? "",
        accountNo: employee.accountNo ?? "",
        superCompany: employee.superCompany ?? "",
        superMembershipNo: employee.superMembershipNo ?? "",
      });
    }
  }, [employee]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<ProfileFormData>) =>
      fetch(`/api/employees/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then(async r => {
        if (!r.ok) throw new Error("Update failed");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", session.id] });
      toast({ title: "Profile Updated Successfully", description: "Your details have been saved." });
      onBack();
    },
    onError: () => {
      toast({ title: "Save Failed", description: "Could not save your profile. Please try again.", variant: "destructive" });
    },
  });

  const uploadFile = async (
    file: File,
    setUploading: (v: boolean) => void,
    formKey: keyof ProfileFormData,
    ref: React.RefObject<HTMLInputElement>,
    successMsg: string,
  ) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error("Upload failed");
      const { url } = await r.json();
      setForm(f => ({ ...f, [formKey]: url }));
      toast({ title: successMsg, description: "Ready to save." });
    } catch {
      toast({ title: "Upload Failed", description: "Could not upload the file.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const handleFhcUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file, setFhcUploading, "fhc", fhcFileRef, "Certificate Uploaded");
  };

  const handleSelfieUpload = (e: React.ChangeEvent<HTMLInputElement>, ref: React.RefObject<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file, setSelfieUploading, "selfieUrl", ref, "Selfie Uploaded");
  };

  const handlePassportUpload = (e: React.ChangeEvent<HTMLInputElement>, ref: React.RefObject<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file, setPassportUploading, "passportUrl", ref, "Passport Uploaded");
  };

  const handleSave = () => {
    const bsbClean = form.bsb.replace(/\s/g, "");
    if (bsbClean && !/^\d{6}$/.test(bsbClean)) {
      setBsbError("BSB must be exactly 6 digits");
      return;
    }
    setBsbError("");
    updateMutation.mutate({ ...form, bsb: bsbClean || null } as any);
  };

  const field = (key: keyof ProfileFormData) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }

  const fullName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-0">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b flex items-center gap-3 px-4 py-3">
        <Button size="icon" variant="ghost" onClick={onBack} data-testid="button-edit-profile-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="font-bold text-base flex-1">Edit My Profile</h2>
        <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-profile">
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          Save
        </Button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-5">

        {/* ── Identity (read-only) ──────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <BadgeCheck className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">My Information</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              <div className="flex items-center gap-3 py-1">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="text-sm font-medium truncate" data-testid="text-identity-name">{fullName || "—"}</p>
                </div>
              </div>
              <div className="border-t" />
              <div className="flex items-center gap-3 py-1">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Nickname</p>
                  <p className="text-sm font-medium truncate" data-testid="text-identity-nickname">{employee?.nickname || "—"}</p>
                </div>
              </div>
              <div className="border-t" />
              <div className="flex items-center gap-3 py-1">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="text-sm font-medium truncate" data-testid="text-identity-phone">{employee?.phone || "—"}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-1">Contact your manager to update name, nickname, or phone number.</p>
            </CardContent>
          </Card>
        </section>

        {/* ── Contact (email) ───────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Email Address</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  placeholder="e.g. name@email.com"
                  {...field("email")}
                  data-testid="input-email"
                  className="h-11 text-base"
                  inputMode="email"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Residential Address ──────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Residential Address</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Street Address</Label>
                <Input placeholder="e.g. 12 Smith Street" {...field("streetAddress")} data-testid="input-street-address" className="h-11 text-base" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Street Address 2 (Apt, Unit, etc.)</Label>
                <Input placeholder="Optional" {...field("streetAddress2")} data-testid="input-street-address-2" className="h-11 text-base" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Suburb</Label>
                  <Input placeholder="Suburb" {...field("suburb")} data-testid="input-suburb" className="h-11 text-base" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))}>
                    <SelectTrigger className="h-11 text-base" data-testid="select-state">
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent>
                      {["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Post Code</Label>
                <Input placeholder="e.g. 2000" {...field("postCode")} data-testid="input-post-code" className="h-11 text-base" inputMode="numeric" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Selfie ───────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Profile Photo (Selfie)</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              {/* Hidden inputs */}
              <input
                ref={selfieCamRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={e => handleSelfieUpload(e, selfieCamRef)}
                data-testid="input-selfie-camera"
              />
              <input
                ref={selfieFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleSelfieUpload(e, selfieFileRef)}
                data-testid="input-selfie-file"
              />

              {selfieUploading && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </div>
              )}

              {!selfieUploading && form.selfieUrl && (
                <div className="flex items-center gap-3">
                  <img
                    src={form.selfieUrl}
                    alt="Profile selfie"
                    className="h-20 w-20 rounded-full object-cover border"
                    data-testid="img-selfie-preview"
                  />
                  <div className="flex flex-col gap-2 flex-1">
                    <Button variant="outline" size="sm" onClick={() => selfieCamRef.current?.click()} data-testid="button-selfie-retake-camera">
                      <Camera className="h-4 w-4 mr-1.5" />
                      Retake Photo
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => selfieFileRef.current?.click()} data-testid="button-selfie-retake-file">
                      <ImagePlus className="h-4 w-4 mr-1.5" />
                      Choose from Library
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setForm(f => ({ ...f, selfieUrl: "" }))} data-testid="button-selfie-remove">
                      <X className="h-4 w-4 mr-1.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {!selfieUploading && !form.selfieUrl && (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-16 flex-col gap-1.5"
                    onClick={() => selfieCamRef.current?.click()}
                    data-testid="button-selfie-camera"
                  >
                    <Camera className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Take Photo</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-16 flex-col gap-1.5"
                    onClick={() => selfieFileRef.current?.click()}
                    data-testid="button-selfie-library"
                  >
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">From Library</span>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Used for identification on your staff profile.</p>
            </CardContent>
          </Card>
        </section>

        {/* ── Passport ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Passport / ID Document</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              {/* Hidden inputs */}
              <input
                ref={passportCamRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => handlePassportUpload(e, passportCamRef)}
                data-testid="input-passport-camera"
              />
              <input
                ref={passportFileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => handlePassportUpload(e, passportFileRef)}
                data-testid="input-passport-file"
              />

              {passportUploading && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </div>
              )}

              {!passportUploading && form.passportUrl && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={form.passportUrl} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-sm text-blue-600 dark:text-blue-400">
                      View Document
                    </a>
                    <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setForm(f => ({ ...f, passportUrl: "" }))} data-testid="button-passport-remove">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" size="sm" onClick={() => passportCamRef.current?.click()} data-testid="button-passport-retake-camera">
                      <Camera className="h-4 w-4 mr-1.5" />
                      Take Photo
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => passportFileRef.current?.click()} data-testid="button-passport-retake-file">
                      <ImagePlus className="h-4 w-4 mr-1.5" />
                      From Library
                    </Button>
                  </div>
                </div>
              )}

              {!passportUploading && !form.passportUrl && (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-16 flex-col gap-1.5"
                    onClick={() => passportCamRef.current?.click()}
                    data-testid="button-passport-camera"
                  >
                    <Camera className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Take Photo</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-16 flex-col gap-1.5"
                    onClick={() => passportFileRef.current?.click()}
                    data-testid="button-passport-library"
                  >
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">From Library</span>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Photo of your passport or government ID. Accepted: image or PDF.</p>
            </CardContent>
          </Card>
        </section>

        {/* ── Food Handler Certificate ─────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Food Handler Certificate (FHC)</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              <input ref={fhcFileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFhcUpload} data-testid="input-fhc-file" />
              {form.fhc ? (
                <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-3">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={form.fhc} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-sm text-blue-600 dark:text-blue-400">
                    View Certificate
                  </a>
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setForm(f => ({ ...f, fhc: "" }))} data-testid="button-remove-fhc">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="h-14 border-dashed flex-col gap-1"
                  onClick={() => fhcFileRef.current?.click()}
                  disabled={fhcUploading}
                  data-testid="button-upload-fhc"
                >
                  {fhcUploading
                    ? <Loader2 className="h-5 w-5 animate-spin" />
                    : <Upload className="h-5 w-5 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">{fhcUploading ? "Uploading..." : "Upload Certificate (PDF or Image)"}</span>
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Upload your Food Handler Certificate so managers can verify your compliance.</p>
            </CardContent>
          </Card>
        </section>

        {/* ── Financial Details ────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Financial Details</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              <div className="rounded-md border border-amber-400/40 bg-amber-400/8 px-3 py-2.5">
                <p className="text-xs text-amber-700 dark:text-amber-400">Your financial details are stored securely and only used for payroll purposes.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">TFN (Tax File Number)</Label>
                <Input placeholder="e.g. 123 456 789" {...field("tfn")} data-testid="input-tfn" className="h-11 text-base font-mono" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">BSB (6 digits, no dash)</Label>
                <Input
                  placeholder="e.g. 062000"
                  value={form.bsb}
                  onChange={e => { setForm(f => ({ ...f, bsb: e.target.value })); setBsbError(""); }}
                  data-testid="input-bsb"
                  className={`h-11 text-base font-mono ${bsbError ? "border-destructive" : ""}`}
                  inputMode="numeric"
                  maxLength={6}
                />
                {bsbError && <p className="text-xs text-destructive" data-testid="error-bsb">{bsbError}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Account Number</Label>
                <Input placeholder="e.g. 12345678" {...field("accountNo")} data-testid="input-account-no" className="h-11 text-base font-mono" inputMode="numeric" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Superannuation ───────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-semibold text-sm">Superannuation</h3>
          </div>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Super Fund Name</Label>
                <Input placeholder="e.g. Australian Super, Hostplus" {...field("superCompany")} data-testid="input-super-company" className="h-11 text-base" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Member Number</Label>
                <Input placeholder="Your membership number" {...field("superMembershipNo")} data-testid="input-super-membership-no" className="h-11 text-base font-mono" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Save Button (bottom) */}
        <Button size="lg" className="w-full h-14 text-base" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-profile-bottom">
          {updateMutation.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Save className="h-5 w-5 mr-2" />}
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>

        <div className="h-4" />
      </div>
    </div>
  );
}

// ── Tab: Settings ─────────────────────────────────────────────────────────────

function SettingsTab({ session, onLogout, onEditProfile }: { session: Session; onLogout: () => void; onEditProfile: () => void }) {
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
            {session.selfieUrl ? (
              <img
                src={session.selfieUrl}
                alt={displayName}
                className="h-14 w-14 rounded-full object-cover shrink-0 border border-border/40"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <User className="h-7 w-7 text-primary" />
              </div>
            )}
            <div>
              <p className="font-semibold text-base" data-testid="text-settings-name">{displayName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{session.firstName} • Staff</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold px-1 mb-1">Account</p>
        <Card>
          <CardContent className="p-0 divide-y">
            {/* Edit My Profile */}
            <button
              type="button"
              data-testid="button-edit-profile"
              className="w-full flex items-center gap-4 px-4 py-4 hover-elevate active-elevate-2 rounded-t-md text-left"
              onClick={onEditProfile}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                <PenLine className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Edit My Profile</p>
                <p className="text-xs text-muted-foreground mt-0.5">Update address, visa, bank &amp; super details</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
            {/* Change PIN */}
            <button
              type="button"
              data-testid="button-change-pin"
              className="w-full flex items-center gap-4 px-4 py-4 hover-elevate active-elevate-2 rounded-b-md text-left"
              onClick={() => {}}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0">
                <KeyRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Change PIN</p>
                <p className="text-xs text-muted-foreground mt-0.5">Default: last 4 digits of your phone</p>
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
  { tab: "home",       label: "Home",       Icon: Home },
  { tab: "schedule",   label: "Schedule",   Icon: CalendarDays },
  { tab: "timesheets", label: "Timesheets", Icon: ListChecks },
  { tab: "settings",   label: "Settings",   Icon: Settings },
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
  const [subView, setSubView] = useState<"edit-profile" | null>(null);

  if (subView === "edit-profile") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <EditProfileView session={session} onBack={() => setSubView(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content area — fills available space between header and bottom nav */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "home"       && <HomeTab session={session} />}
        {activeTab === "schedule"   && <ScheduleTab session={session} />}
        {activeTab === "timesheets" && <TimesheetsTab session={session} />}
        {activeTab === "settings"   && (
          <SettingsTab
            session={session}
            onLogout={onLogout}
            onEditProfile={() => setSubView("edit-profile")}
          />
        )}
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
