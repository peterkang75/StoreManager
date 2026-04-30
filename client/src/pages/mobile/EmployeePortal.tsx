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
import { storeColorFor } from "@shared/storeColors";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "home" | "schedule" | "timesheets" | "settings";

interface Session { id: string; nickname: string | null; firstName: string; selfieUrl?: string | null; role?: string | null; storeId?: string | null; storeIds?: string[]; isFirstLogin?: boolean }

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

interface ShiftWithStore extends ShiftInfo { storeName?: string; storeColor?: string }
interface DayData {
  date: string;
  shifts: ShiftWithStore[];
  timesheets: TimesheetInfo[];
  // Legacy alias — first shift/timesheet for backwards compat.
  shift: ShiftWithStore | null;
  timesheet: TimesheetInfo | null;
}
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
// Use localStorage so accidental tab close / refresh / crash doesn't instantly
// log the employee out. Previously used sessionStorage which kicked users back
// to the PIN screen any time the browser reloaded — hostile UX for kitchen
// staff who may accidentally hit reload or have their tab restored.
// Migration: clean up any leftover sessionStorage key from the old build.

const SESSION_KEY = "ep_session_v5";
const LEGACY_SESSION_KEY = "ep_session_v4";
const PORTAL_TOKEN_KEY = "ep_portal_token_v1";
function loadSession(): Session | null {
  try {
    // From the moment portal auth shipped, a session is only valid if the
    // bearer token is also present. Sessions saved before the auth change
    // have no token and would just produce 401s on every API call — clear
    // them so the user lands on the PIN screen instead.
    const hasToken = !!localStorage.getItem(PORTAL_TOKEN_KEY);
    const r = localStorage.getItem(SESSION_KEY);
    if (r) {
      if (!hasToken) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return JSON.parse(r);
    }
    // Fallback: migrate from sessionStorage if upgrading mid-session
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      // Legacy sessions have no token either — drop them.
      if (!hasToken) return null;
      localStorage.setItem(SESSION_KEY, legacy);
      return JSON.parse(legacy);
    }
    return null;
  } catch { return null; }
}
function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:  { bg: "bg-amber-100 dark:bg-amber-950",  text: "text-amber-800 dark:text-amber-300",  label: "Pending Approval" },
  APPROVED: { bg: "bg-green-100 dark:bg-green-950",  text: "text-green-800 dark:text-green-300",  label: "Approved" },
  REJECTED: { bg: "bg-red-100 dark:bg-red-950",      text: "text-red-800 dark:text-red-300",      label: "Rejected" },
};

// ── 1-Step PIN Login ──────────────────────────────────────────────────────────

const AL = {
  font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
};

function PinLogin({ onSuccess }: { onSuccess: (s: Session) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  // Per-device flag: hide first-time PIN hint and the ⌫-cancel tip after the
  // very first successful login on this browser. Subsequent logins show only
  // "Enter your 4-digit PIN".
  const [hasLoggedInBefore] = useState<boolean>(() => {
    try { return localStorage.getItem("crew_has_logged_in") === "1"; } catch { return false; }
  });

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
    onSuccess: (data) => {
      try { localStorage.setItem("crew_has_logged_in", "1"); } catch {}
      // Store the bearer token so subsequent /api/portal/* calls authenticate.
      // queryClient's fetch wrapper picks this up automatically.
      try { if (data.token) localStorage.setItem("ep_portal_token_v1", data.token); } catch {}
      onSuccess({ id: data.id, nickname: data.nickname, firstName: data.firstName, selfieUrl: data.selfieUrl ?? null, role: data.role ?? null, storeId: data.storeId ?? null, storeIds: data.storeIds ?? [], isFirstLogin: !!data.isFirstLogin });
    },
    onError: (err: Error) => { setError(err.message); setPin(""); },
  });

  // Stable ref for the auto-submit timer so Backspace during the grace window
  // cancels the pending mutation — gives the user a moment to recover from a
  // mistyped 4th digit before the app actually logs in.
  const autoSubmitTimerRef = useRef<number | null>(null);
  const cancelAutoSubmit = () => {
    if (autoSubmitTimerRef.current !== null) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
  };
  const handleDigit = (d: string) => {
    setError("");
    setPin(prev => {
      if (prev.length >= 4) return prev;
      const next = prev + d;
      if (next.length === 4) {
        cancelAutoSubmit();
        // 350ms gives mis-tappers a window to hit Backspace before the
        // request fires. Still feels snappy on a good connection.
        autoSubmitTimerRef.current = window.setTimeout(() => {
          autoSubmitTimerRef.current = null;
          loginMutation.mutate(next);
        }, 350);
      }
      return next;
    });
  };
  const handleDel = () => {
    // Cancel any pending auto-submit when the user backspaces — they want to
    // fix a mistake, not log in.
    cancelAutoSubmit();
    setPin(p => p.slice(0, -1));
    setError("");
  };
  useEffect(() => () => cancelAutoSubmit(), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, padding: "40px 24px 32px", gap: 0, fontFamily: AL.font, background: "#ffffff" }}>

      {/* Brand wordmark — app title (store logos moved to the top header) */}
      <div style={{ textAlign: "center", marginBottom: 64 }}>
        <h1 style={{ fontSize: 56, fontWeight: 700, color: "#222222", letterSpacing: "-1px", lineHeight: 1, margin: 0 }} data-testid="text-app-title">
          Crew<span style={{ color: "#ef4444", fontSize: 48, lineHeight: 1, marginLeft: 2 }}>.</span>
        </h1>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#6a6a6a", letterSpacing: "1.6px", textTransform: "uppercase", margin: "14px 0 0" }}>
          Team Portal
        </p>
      </div>

      {/* PIN prompt */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "#222222", margin: 0 }}>Enter your 4-digit PIN</p>
        {!hasLoggedInBefore && (
          <>
            <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 4 }}>
              First time? Use the <b>last 4 digits of the mobile number</b> you gave your manager.
            </p>
            <p style={{ fontSize: 11, color: "#929292", marginTop: 4 }}>
              Tap ⌫ within a moment to cancel if you type a wrong digit.
            </p>
          </>
        )}
      </div>

      {/* PIN dots */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20 }} data-testid="pin-dots">
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: "50%",
            border: `2px solid ${i < pin.length ? "#ef4444" : "#c1c1c1"}`,
            background: i < pin.length ? "#ef4444" : "transparent",
            transform: i < pin.length ? "scale(1.15)" : "scale(1)",
            transition: "all 150ms",
          }} />
        ))}
      </div>

      {/* Error / loading */}
      <div style={{ width: "100%", maxWidth: 320, minHeight: 40, marginBottom: 8 }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#ef4444", background: "rgba(239,68,68,0.08)", borderRadius: 8, padding: "10px 14px" }}>
            <AlertCircle style={{ width: 15, height: 15, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
        {loginMutation.isPending && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Loader2 style={{ width: 22, height: 22, color: "#6a6a6a", animation: "spin 1s linear infinite" }} className="animate-spin" />
          </div>
        )}
      </div>

      {/* Numpad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 320, marginTop: 8 }}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => {
          const isPressed = pressedKey === `${idx}`;
          const isDel = key === "⌫";
          const isEmpty = key === "";
          return (
            <button
              key={idx} type="button"
              disabled={loginMutation.isPending || isEmpty}
              data-testid={isDel ? "pin-delete" : key ? `pin-digit-${key}` : undefined}
              onPointerDown={(e) => {
                if (isEmpty || loginMutation.isPending) return;
                e.preventDefault();
                (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                setPressedKey(`${idx}`);
                if (isDel) handleDel();
                else handleDigit(key);
              }}
              onPointerUp={() => setPressedKey(null)}
              onPointerCancel={() => setPressedKey(null)}
              onPointerLeave={() => setPressedKey(null)}
              style={{
                height: 72,
                borderRadius: 16,
                border: "none",
                cursor: isEmpty ? "default" : "pointer",
                visibility: isEmpty ? "hidden" : "visible",
                background: isDel
                  ? (isPressed ? "rgba(239,68,68,0.12)" : "transparent")
                  : (isPressed ? "rgba(239,68,68,0.15)" : "#f2f2f2"),
                color: isPressed ? "#ef4444" : (isDel ? "#6a6a6a" : "#222222"),
                transform: isPressed ? "scale(0.96)" : "scale(1)",
                fontSize: 24,
                fontWeight: 600,
                fontFamily: AL.font,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
                userSelect: "none",
                WebkitUserSelect: "none",
                transition: "background 80ms, color 80ms, transform 80ms",
              }}
            >{key}</button>
          );
        })}
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

  // Ref-based guard prevents a slow second tap from firing while the button is
  // mid-transition to disabled. State-based `isPending` alone can race on slow
  // devices — the ref update is synchronous.
  const inFlightRef = useRef(false);
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
      inFlightRef.current = false;
      toast({ title: "Submitted", description: `${item.storeName} timesheet recorded.` });
      onSubmitted(data);
      onClose();
    },
    onError: (err: Error) => {
      inFlightRef.current = false;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmitPress = () => {
    if (inFlightRef.current || submitMutation.isPending) return;
    // Soft confirmation for modified hours — if the user is logging hours that
    // don't match their rostered shift, double-check before sending. Protects
    // against accidental taps that would otherwise require a manager fix.
    if (isModified) {
      const ok = window.confirm(
        `Submit ${hours.toFixed(1)}h for ${item.storeName}?\n` +
        `Rostered: ${shift.startTime}–${shift.endTime}\n` +
        `You entered: ${startTime}–${endTime}\n\n` +
        `Once submitted you'll need to ask your manager to edit it.`
      );
      if (!ok) return;
    }
    inFlightRef.current = true;
    submitMutation.mutate();
  };

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
            onPointerDown={(e) => { e.preventDefault(); handleSubmitPress(); }}
            disabled={!canSubmit || submitMutation.isPending}
            style={{
              backgroundColor: item.storeColor,
              borderColor: item.storeColor,
              color: "white",
              height: 52,
              fontSize: 16,
              fontWeight: 600,
              opacity: (!canSubmit || submitMutation.isPending) ? 0.6 : 1,
            }}
            data-testid="button-submit-timesheet"
          >
            {submitMutation.isPending
              ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /><span>Submitting…</span></>
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
        style={{
          background: "#fff",
          borderRadius: 20,
          boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
          overflow: "hidden",
          borderLeft: `4px solid ${item.storeColor ?? "#6a6a6a"}`,
        }}
      >
        {/* Content */}
        <div className="flex-1 p-5">
          {/* Row 1: store name + status badge — name sized big enough to read
              under bright kitchen lights without squinting */}
          <div className="flex items-start justify-between gap-2 mb-4">
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              fontWeight: 800, fontSize: 18,
              color: item.storeColor ?? "#222222",
              letterSpacing: "-0.2px",
              lineHeight: 1.1,
            }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: item.storeColor ?? "#6a6a6a" }} />
              {item.storeName}
            </span>
            {ts && st && (
              <div className={`flex items-center gap-1 px-2 py-1 shrink-0 ${st.bg}`} style={{ borderRadius: 14 }}>
                <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
                <span className={`text-[11px] font-semibold ${st.text}`}>{st.label}</span>
              </div>
            )}
          </div>

          {/* Time range */}
          <p
            className="tabular-nums leading-none"
            data-testid="text-shift-time"
            style={{ fontSize: 32, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px" }}
          >
            {shift.startTime} – {shift.endTime}
          </p>
          <p style={{ fontSize: 13, color: "#6a6a6a", marginTop: 6 }}>{hours.toFixed(1)} hours</p>

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
              style={{ backgroundColor: "#ef4444", borderColor: "#ef4444", color: "white", borderRadius: 8 }}
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
  // Smart defaults: start = current time rounded down to nearest 15 min
  // End = 8 hours later (typical shift length), capped at 23:45 same day.
  // Much closer to reality than the old hard-coded 09:00–17:00 and saves the
  // user dozens of taps scrolling through 96 slots.
  function nowTimeSlot(): string {
    const d = new Date();
    const h = d.getHours();
    const m = Math.floor(d.getMinutes() / 15) * 15;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  function plusHours(t: string, hours: number): string {
    const [h, m] = t.split(":").map(Number);
    let total = h * 60 + m + hours * 60;
    total = Math.min(total, 23 * 60 + 45); // cap at 23:45
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
  }
  const defaultStart = nowTimeSlot();
  const defaultEnd = plusHours(defaultStart, 8);
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
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
      // Re-compute on each open so the default reflects "now" at drawer open
      // rather than when the component first mounted.
      const s = nowTimeSlot();
      setStartTime(s);
      setEndTime(plusHours(s, 8));
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
        storeColor: storeColorFor(store?.name ?? null),
      });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const A = {
    font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
  };

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DrawerContent style={{ fontFamily: A.font, background: "#ffffff" }}>
        <DrawerHeader>
          <DrawerTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 700, color: "#222222", letterSpacing: "-0.2px" }}>
            <AlertTriangle style={{ width: 18, height: 18, color: "#ef4444" }} />
            Log Unscheduled Shift
          </DrawerTitle>
          <p style={{ fontSize: 13, color: "#6a6a6a", textAlign: "left", marginTop: 4 }}>{today} · Hours will be pending manager approval</p>
        </DrawerHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "0 16px 8px" }}>
          {/* Store */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#222222" }}>Store worked at</label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger data-testid="select-unscheduled-store" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font, background: "#ffffff", border: "1px solid #c1c1c1", color: "#222222" }}>
                <SelectValue placeholder="Select store…" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id} style={{ fontSize: 16, padding: "12px 14px" }}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Start / End time */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#222222" }}>Start Time</label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger data-testid="select-unscheduled-start" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font, background: "#ffffff", border: "1px solid #c1c1c1", color: "#222222" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t} style={{ fontSize: 16, padding: "12px 14px" }}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#222222" }}>End Time</label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger data-testid="select-unscheduled-end" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font, background: "#ffffff", border: "1px solid #c1c1c1", color: "#222222" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-52">
                  {TIME_SLOTS.map(t => <SelectItem key={t} value={t} style={{ fontSize: 16, padding: "12px 14px" }}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hours > 0 && (
            <p style={{ fontSize: 13, color: "#6a6a6a", fontVariantNumeric: "tabular-nums" }}>
              Total: <span style={{ fontWeight: 600, color: "#222222" }}>{hours.toFixed(1)} hrs</span>
            </p>
          )}
          {hours <= 0 && startTime && endTime && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", borderRadius: 10,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.4)",
            }}>
              <AlertCircle style={{ width: 18, height: 18, color: "#ef4444", flexShrink: 0 }} />
              <p style={{ fontSize: 14, color: "#c13515", margin: 0, fontWeight: 500 }}>
                End time must be later than start time. Check the two time fields above.
              </p>
            </div>
          )}

          {/* Reason — required */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#222222" }}>
              Reason <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              data-testid="textarea-unscheduled-reason"
              placeholder="e.g. Covering for sick staff, called in by manager…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "12px 14px", fontSize: 16, color: "#222222",
                background: "#ffffff", border: "1px solid #c1c1c1", borderRadius: 12,
                fontFamily: A.font, outline: "none", resize: "none",
                lineHeight: 1.5,
              }}
            />
            <p style={{ fontSize: 12, color: "#6a6a6a" }}>Required — explain why you worked without a scheduled shift</p>
          </div>
        </div>

        <DrawerFooter style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            data-testid="button-submit-unscheduled"
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
            style={{
              width: "100%", height: 56,
              background: !canSubmit || submitMutation.isPending ? "#f2f2f2" : "#ef4444",
              color: !canSubmit || submitMutation.isPending ? "#6a6a6a" : "#ffffff",
              border: "none", borderRadius: 12,
              fontSize: 17, fontWeight: 600,
              cursor: !canSubmit || submitMutation.isPending ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: A.font,
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {submitMutation.isPending && <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />}
            Submit for Approval
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitMutation.isPending}
            style={{
              width: "100%", height: 48,
              background: "transparent", color: "#222222",
              border: "none", borderRadius: 12,
              fontSize: 15, fontWeight: 500,
              cursor: "pointer", fontFamily: A.font,
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >Cancel</button>
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
  "Vegetables", "Beverages", "Pantry & Dry Goods", "Other",
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: activeQK });
      const prev = qc.getQueryData<ActiveListEntry[]>(activeQK);
      qc.setQueryData<ActiveListEntry[]>(activeQK, (old = []) => old.filter(e => e.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(activeQK, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const addMutation = useMutation({
    mutationFn: (itemId: number) =>
      fetch("/api/shopping/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, storeId }),
      }).then(r => r.json()),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: activeQK });
      const prev = qc.getQueryData<ActiveListEntry[]>(activeQK);
      const catalogItem = catalog.find(c => c.id === itemId);
      if (catalogItem) {
        qc.setQueryData<ActiveListEntry[]>(activeQK, (old = []) => [
          ...old,
          { id: -Date.now(), itemId, storeId: storeId ?? null, createdAt: new Date().toISOString(), item: catalogItem } as any,
        ]);
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(activeQK, ctx.prev);
    },
    onSettled: invalidateBoth,
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

  // Freeze the sort order when the drawer opens so tapping items does not
  // reorder the list (selectionCount on the server updates and would
  // otherwise push just-tapped items to the top mid-interaction).
  const sortSnapshotRef = useRef<Map<number, number>>(new Map());
  const prevSheetOpenRef = useRef(false);
  if (addSheetOpen && !prevSheetOpenRef.current) {
    const snap = new Map<number, number>();
    catalog.forEach(i => snap.set(i.id, i.selectionCount ?? 0));
    sortSnapshotRef.current = snap;
  }
  prevSheetOpenRef.current = addSheetOpen;

  const filteredCatalog = catalog
    .filter(i => i.name.toLowerCase().includes(catalogSearch.toLowerCase()))
    .sort((a, b) => {
      const ac = sortSnapshotRef.current.get(a.id) ?? (a.selectionCount ?? 0);
      const bc = sortSnapshotRef.current.get(b.id) ?? (b.selectionCount ?? 0);
      if (bc !== ac) return bc - ac;
      return a.name.localeCompare(b.name);
    });
  const catalogGrouped = filteredCatalog.reduce<Record<string, ShoppingItem[]>>((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i);
    return acc;
  }, {});
  const catalogCategories = Object.keys(catalogGrouped).sort();

  const A = {
    font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
    shadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 120, fontFamily: A.font }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#222222", letterSpacing: "-0.18px" }}>Today's List</h3>
          <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>
            {activeList.length} item{activeList.length !== 1 ? "s" : ""}
          </p>
        </div>
        {activeList.length > 0 && (
          <button
            type="button"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6a6a6a", background: "transparent", border: "none", cursor: "pointer" }}
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            data-testid="button-clear-list"
          >
            <Trash2 style={{ width: 14, height: 14 }} />
            Clear all
          </button>
        )}
      </div>

      {listLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Loader2 style={{ width: 24, height: 24, color: "#6a6a6a" }} className="animate-spin" />
        </div>
      )}

      {!listLoading && activeList.length === 0 && (
        <div style={{ background: "#ffffff", borderRadius: 20, padding: "40px 20px", textAlign: "center", boxShadow: A.shadow }}>
          <ShoppingCart style={{ width: 40, height: 40, color: "#c1c1c1", margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600, fontSize: 15, color: "#222222" }}>Your list is empty</p>
          <p style={{ fontSize: 13, color: "#6a6a6a", marginTop: 4 }}>Tap "Add Items" to build today's shopping list.</p>
        </div>
      )}

      {activeCategories.map(category => (
        <div key={category}>
          <div style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", paddingTop: 8, paddingBottom: 8, zIndex: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a" }}>{category}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grouped[category].map(entry => (
              <button
                key={entry.id}
                type="button"
                data-testid={`button-check-item-${entry.id}`}
                onClick={() => removeMutation.mutate(entry.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 16, minHeight: 56, width: "100%",
                  padding: "12px 16px", borderRadius: 20, background: "#ffffff", border: "none",
                  cursor: "pointer", textAlign: "left", boxShadow: A.shadow,
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              >
                <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid #c1c1c1", flexShrink: 0 }} />
                <span style={{ fontSize: 16, fontWeight: 500, color: "#222222", flex: 1 }}>{entry.item.name}</span>
                <CheckCheck style={{ width: 16, height: 16, color: "rgba(0,0,0,0.15)", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        style={{ width: "100%", height: 56, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#222222", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500, cursor: "pointer", marginTop: 8, fontFamily: A.font }}
        onClick={() => setAddSheetOpen(true)}
        data-testid="button-open-add-items"
      >
        <Plus style={{ width: 20, height: 20 }} />
        Add Items
      </button>

      {/* Add Items Drawer */}
      <Drawer open={addSheetOpen} onOpenChange={setAddSheetOpen}>
        <DrawerContent className="max-h-[92vh] flex flex-col" style={{ fontFamily: A.font }}>
          <DrawerHeader className="shrink-0">
            <DrawerTitle style={{ fontSize: 20, fontWeight: 700, color: "#222222", letterSpacing: "-0.2px" }}>Add Items</DrawerTitle>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto" style={{ padding: "0 16px" }}>
            <div style={{ position: "sticky", top: 0, background: "#ffffff", paddingTop: 4, paddingBottom: 12, zIndex: 10 }}>
              <div style={{ position: "relative" }}>
                <Search style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 18, height: 18, color: "#6a6a6a" }} />
                <input
                  placeholder="Search items…"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  data-testid="input-catalog-search"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    height: 52, paddingLeft: 44, paddingRight: 14,
                    fontSize: 16, color: "#222222",
                    background: "#f2f2f2", border: "none", borderRadius: 12,
                    fontFamily: A.font, outline: "none",
                  }}
                />
              </div>
            </div>

            {catalogCategories.map(category => (
              <div key={category} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a", marginBottom: 10 }}>{category}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {catalogGrouped[category].map(item => {
                    const inList = activeItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`button-catalog-item-${item.id}`}
                        onClick={() => !inList && addMutation.mutate(item.id)}
                        disabled={inList}
                        style={{
                          display: "flex", alignItems: "center", gap: 14, minHeight: 60, width: "100%",
                          padding: "14px 16px", borderRadius: 16,
                          background: inList ? "rgba(239,68,68,0.08)" : "#ffffff",
                          border: `1px solid ${inList ? "#ef4444" : "#c1c1c1"}`,
                          cursor: inList ? "default" : "pointer", textAlign: "left",
                          fontFamily: A.font,
                          transition: "background 160ms, border-color 160ms",
                          touchAction: "manipulation",
                          WebkitTapHighlightColor: "transparent",
                          userSelect: "none",
                          WebkitUserSelect: "none",
                        }}
                      >
                        {inList
                          ? <CheckCheck style={{ width: 22, height: 22, color: "#ef4444", flexShrink: 0 }} />
                          : <Plus style={{ width: 22, height: 22, color: "#6a6a6a", flexShrink: 0 }} />
                        }
                        <span style={{ flex: 1, fontWeight: inList ? 600 : 500, fontSize: 17, color: inList ? "#ef4444" : "#222222" }}>{item.name}</span>
                        {item.selectionCount > 0 && (
                          <span style={{ fontSize: 13, color: inList ? "#ef4444" : "#6a6a6a" }}>{item.selectionCount}×</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {catalog.length === 0 && !catalogSearch && (
              <p style={{ fontSize: 15, color: "#6a6a6a", textAlign: "center", padding: "20px 0" }}>No items in catalog yet. Create one below.</p>
            )}
            {catalog.length > 0 && filteredCatalog.length === 0 && (
              <p style={{ fontSize: 15, color: "#6a6a6a", textAlign: "center", padding: "20px 0" }}>No items match "{catalogSearch}".</p>
            )}

            <div style={{ borderTop: "1px solid #c1c1c1", marginTop: 20, paddingTop: 20, paddingBottom: 20 }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#222222", marginBottom: 14 }}>Create New Item</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  placeholder="Item name"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  data-testid="input-new-item-name"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    height: 52, padding: "0 14px", fontSize: 16, color: "#222222",
                    background: "#ffffff", border: "1px solid #c1c1c1", borderRadius: 12,
                    fontFamily: A.font, outline: "none",
                  }}
                />
                <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                  <SelectTrigger data-testid="select-new-item-category" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font }}>
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOPPING_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c} style={{ fontSize: 16, padding: "12px 14px" }}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  disabled={!newItemName.trim() || !newItemCategory || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                  data-testid="button-create-new-item"
                  style={{
                    width: "100%", height: 56,
                    background: !newItemName.trim() || !newItemCategory || createMutation.isPending ? "#f2f2f2" : "#222222",
                    color: !newItemName.trim() || !newItemCategory || createMutation.isPending ? "#6a6a6a" : "#ffffff",
                    border: "none", borderRadius: 12, fontSize: 17, fontWeight: 600,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    fontFamily: A.font,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {createMutation.isPending
                    ? <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
                    : <Plus style={{ width: 20, height: 20 }} />}
                  Add to List
                </button>
              </div>
            </div>
          </div>

          <DrawerFooter className="shrink-0">
            <button
              type="button"
              onClick={() => setAddSheetOpen(false)}
              style={{
                width: "100%", height: 56,
                background: "#ffffff", color: "#222222",
                border: "1px solid #c1c1c1", borderRadius: 12,
                fontSize: 17, fontWeight: 600, cursor: "pointer",
                fontFamily: A.font,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >Done</button>
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
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: activeQK });
      const prev = qc.getQueryData<ActiveStorageEntry[]>(activeQK);
      const catalogItem = catalog.find(c => c.id === itemId);
      if (catalogItem) {
        qc.setQueryData<ActiveStorageEntry[]>(activeQK, (old = []) => [
          ...old,
          { id: -Date.now(), itemId, storeId: storeId ?? null, createdAt: new Date().toISOString(), item: catalogItem } as any,
        ]);
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(activeQK, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: activeQK }),
  });

  const removeFromActiveMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/storage/active/${id}`, { method: "DELETE" }).then(r => r.json()),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: activeQK });
      const prev = qc.getQueryData<ActiveStorageEntry[]>(activeQK);
      qc.setQueryData<ActiveStorageEntry[]>(activeQK, (old = []) => old.filter(e => e.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(activeQK, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: activeQK }),
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

  const A = {
    font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
    shadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 120, fontFamily: A.font }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ fontWeight: 700, fontSize: 18, color: "#222222", letterSpacing: "-0.18px" }}>Storage Check</h3>
          <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>
            {activeList.length} item{activeList.length !== 1 ? "s" : ""} to fetch
          </p>
        </div>
        {activeList.length > 0 && (
          <button
            type="button"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6a6a6a", background: "transparent", border: "none", cursor: "pointer" }}
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            data-testid="button-clear-storage-list"
          >
            <Trash2 style={{ width: 14, height: 14 }} />
            Clear all
          </button>
        )}
      </div>

      {activeList.length === 0 && (
        <div style={{ background: "#ffffff", borderRadius: 20, padding: "40px 20px", textAlign: "center", boxShadow: A.shadow }}>
          <Package style={{ width: 40, height: 40, color: "#c1c1c1", margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 600, fontSize: 15, color: "#222222" }}>Nothing to fetch</p>
          <p style={{ fontSize: 13, color: "#6a6a6a", marginTop: 4 }}>Add items from the catalogue below.</p>
        </div>
      )}

      {pendingCategories.map(cat => (
        <div key={cat}>
          <div style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", paddingTop: 8, paddingBottom: 8, zIndex: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a" }}>{cat}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingByCategory[cat].map(entry => (
              <div
                key={entry.id}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 12px 8px 8px", borderRadius: 20, background: "#ffffff", boxShadow: A.shadow }}
              >
                <button
                  type="button"
                  data-testid={`button-fetch-storage-${entry.id}`}
                  onClick={() => removeFromActiveMutation.mutate(entry.id)}
                  aria-label={`Fetched ${entry.item.name}`}
                  style={{
                    width: 44, height: 44, borderRadius: "50%", border: "none", background: "transparent",
                    flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid #c1c1c1", display: "block" }} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 500, color: "#222222" }}>{entry.item.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: "#6a6a6a" }}>{entry.item.unit ?? "ea"}</span>
                </div>
                <button
                  type="button"
                  data-testid={`button-check-stock-${entry.id}`}
                  onClick={() => {
                    setSelectedItem(entry.item);
                    setStockValue(entry.item.currentStock !== null ? String(entry.item.currentStock) : "");
                    setCheckSheetOpen(true);
                  }}
                  style={{
                    fontSize: 12, fontWeight: 600, color: "#460479", background: "transparent",
                    border: "none", cursor: "pointer", padding: "8px 12px", flexShrink: 0,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  Log stock
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        style={{ width: "100%", height: 56, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#222222", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500, cursor: "pointer", marginTop: 8, fontFamily: A.font }}
        onClick={() => setAddItemOpen(true)}
        data-testid="button-open-add-storage"
      >
        <Plus style={{ width: 20, height: 20 }} />
        Add Items
      </button>

      {/* Catalogue Drawer */}
      <Drawer open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DrawerContent className="max-h-[92vh] flex flex-col" style={{ fontFamily: A.font }}>
          <DrawerHeader className="shrink-0">
            <DrawerTitle style={{ fontSize: 20, fontWeight: 700, color: "#222222", letterSpacing: "-0.2px" }}>Storage Catalogue</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto" style={{ padding: "0 16px" }}>
            {catalogLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 style={{ width: 24, height: 24, color: "#6a6a6a" }} className="animate-spin" />
              </div>
            )}
            {catalogCategories.map(cat => (
              <div key={cat} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a", marginBottom: 10 }}>{cat}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {catalogByCategory[cat].map(item => {
                    const inList = activeItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`button-storage-catalog-${item.id}`}
                        onClick={() => !inList && addToActiveMutation.mutate(item.id)}
                        disabled={inList}
                        style={{
                          display: "flex", alignItems: "center", gap: 14, minHeight: 60, width: "100%",
                          padding: "14px 16px", borderRadius: 16,
                          background: inList ? "rgba(70,4,121,0.08)" : "#ffffff",
                          border: `1px solid ${inList ? "#460479" : "#c1c1c1"}`,
                          cursor: inList ? "default" : "pointer", textAlign: "left",
                          fontFamily: A.font,
                          transition: "background 160ms, border-color 160ms",
                          touchAction: "manipulation",
                          WebkitTapHighlightColor: "transparent",
                          userSelect: "none",
                          WebkitUserSelect: "none",
                        }}
                      >
                        {inList
                          ? <CheckCheck style={{ width: 22, height: 22, color: "#460479", flexShrink: 0 }} />
                          : <Plus style={{ width: 22, height: 22, color: "#6a6a6a", flexShrink: 0 }} />}
                        <span style={{ flex: 1, fontWeight: inList ? 600 : 500, fontSize: 17, color: inList ? "#460479" : "#222222" }}>{item.name}</span>
                        <span style={{ fontSize: 13, color: inList ? "#460479" : "#6a6a6a" }}>{item.unit}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {catalog.length === 0 && !catalogLoading && (
              <p style={{ fontSize: 15, color: "#6a6a6a", textAlign: "center", padding: "20px 0" }}>No items in catalogue yet. Create one below.</p>
            )}

            <div style={{ borderTop: "1px solid #c1c1c1", marginTop: 20, paddingTop: 20, paddingBottom: 20 }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#222222", marginBottom: 14 }}>Create New Item</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  placeholder="Item name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  data-testid="input-storage-new-name"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    height: 52, padding: "0 14px", fontSize: 16, color: "#222222",
                    background: "#ffffff", border: "1px solid #c1c1c1", borderRadius: 12,
                    fontFamily: A.font, outline: "none",
                  }}
                />
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger data-testid="select-storage-category" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font }}>
                    <SelectValue placeholder="Select category…" />
                  </SelectTrigger>
                  <SelectContent>
                    {STORAGE_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c} style={{ fontSize: 16, padding: "12px 14px" }}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={newUnit} onValueChange={setNewUnit}>
                  <SelectTrigger data-testid="select-storage-unit" style={{ height: 52, fontSize: 16, borderRadius: 12, fontFamily: A.font }}>
                    <SelectValue placeholder="Unit…" />
                  </SelectTrigger>
                  <SelectContent>
                    {storageUnits.map(u => (
                      <SelectItem key={u.id} value={u.name} style={{ fontSize: 16, padding: "12px 14px" }}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  disabled={!newName.trim() || !newCategory || createItemMutation.isPending}
                  onClick={() => createItemMutation.mutate()}
                  data-testid="button-create-storage-item"
                  style={{
                    width: "100%", height: 56,
                    background: !newName.trim() || !newCategory || createItemMutation.isPending ? "#f2f2f2" : "#222222",
                    color: !newName.trim() || !newCategory || createItemMutation.isPending ? "#6a6a6a" : "#ffffff",
                    border: "none", borderRadius: 12, fontSize: 17, fontWeight: 600,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    fontFamily: A.font,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {createItemMutation.isPending
                    ? <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
                    : <Plus style={{ width: 20, height: 20 }} />}
                  Add to List
                </button>
              </div>
            </div>
          </div>
          <DrawerFooter className="shrink-0">
            <button
              type="button"
              onClick={() => setAddItemOpen(false)}
              style={{
                width: "100%", height: 56,
                background: "#ffffff", color: "#222222",
                border: "1px solid #c1c1c1", borderRadius: 12,
                fontSize: 17, fontWeight: 600, cursor: "pointer",
                fontFamily: A.font,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >Done</button>
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
            <p style={{ fontSize: 13, color: "#6a6a6a" }}>How many left?</p>
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
              <span style={{ fontSize: 14, fontWeight: 500, color: "#6a6a6a", flexShrink: 0, minWidth: 40 }}>
                {selectedItem?.unit ?? "ea"}
              </span>
            </div>
          </div>
          <DrawerFooter>
            <button
              type="button"
              style={{ width: "100%", padding: "14px 24px", background: !stockValue || updateStockMutation.isPending ? "#f2f2f2" : "#222222", color: !stockValue || updateStockMutation.isPending ? "#6a6a6a" : "#ffffff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: A.font }}
              disabled={!stockValue || updateStockMutation.isPending}
              onClick={() => {
                if (selectedItem) updateStockMutation.mutate({ id: selectedItem.id, currentStock: Number(stockValue) });
              }}
              data-testid="button-submit-stock"
            >
              {updateStockMutation.isPending ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : "Save"}
            </button>
            <Button variant="outline" onClick={() => setCheckSheetOpen(false)}>Cancel</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// ── Tab: Home ─────────────────────────────────────────────────────────────────

type HomeSubTab = "myDay" | "shopping" | "storage";

function HomeTab({ session, onEditProfile }: { session: Session; onEditProfile: () => void }) {
  const today = getTodayStr();
  const [, navigate] = useLocation();
  const [localTimesheets, setLocalTimesheets] = useState<Record<string, TimesheetInfo>>({});
  const [localUnscheduled, setLocalUnscheduled] = useState<UnscheduledTimesheetItem[]>([]);
  const [unscheduledDrawerOpen, setUnscheduledDrawerOpen] = useState(false);
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>("myDay");
  const qc = useQueryClient();
  const displayName = session.nickname || session.firstName;

  // Dismissed notice IDs, stored per-device in localStorage so a staff
  // member who has read a notice doesn't keep seeing it every open.
  const DISMISSED_NOTICES_KEY = `ep_dismissed_notices_${session.id}`;
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_NOTICES_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const dismissNotice = (id: string) => {
    setDismissedNoticeIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(DISMISSED_NOTICES_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const todayQK = ["/api/portal/today", session.id, today];
  const { data: todayData, isLoading: todayLoading } = useQuery<TodayData>({
    queryKey: todayQK,
    queryFn: async () => {
      const res = await fetch(`/api/portal/today?employeeId=${session.id}&date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const { data: employeeProfile } = useQuery<any>({
    queryKey: ["/api/employees", session.id],
    queryFn: () => fetch(`/api/employees/${session.id}`).then(r => r.ok ? r.json() : {}),
    staleTime: 60_000,
  });

  // Action-required banner: list the exact missing fields so the staff
  // member knows what's needed. Old copy just said "Financial Details" /
  // "Superannuation" which left ESL users guessing which specific rows.
  const missingFinancialFields = employeeProfile ? (() => {
    const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === "";
    const names: string[] = [];
    if (isEmpty(employeeProfile.tfn)) names.push("TFN");
    if (isEmpty(employeeProfile.bsb)) names.push("BSB");
    if (isEmpty(employeeProfile.accountNo)) names.push("Account Number");
    if (isEmpty(employeeProfile.superCompany)) names.push("Super Fund");
    if (isEmpty(employeeProfile.superMembershipNo)) names.push("Super Member #");
    return names;
  })() : [];
  // Backwards-compat alias for any references further down the file.
  const missingFinancial = missingFinancialFields;

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

  // Admin Dashboard button lives in the top header (see EmployeePortal).

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

  // Shifts scheduled for today that still have no timesheet submitted.
  // We display this count prominently so staff don't finish a shift, close the
  // app, and forget to submit — a common failure mode caught by the UX audit.
  const pendingTimesheetCount = todayShifts.filter(s => !s.timesheet).length;

  return (
    <div className="flex flex-col gap-5 px-4 py-5" style={{ background: "#ffffff", minHeight: "100%", fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, Roboto, 'Helvetica Neue', sans-serif" }}>
      {/* Action required banner — missing Financial / Super details */}
      {missingFinancial.length > 0 && (
        <button
          type="button"
          onClick={onEditProfile}
          data-testid="banner-action-required"
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", borderRadius: 14,
            background: "rgba(239,68,68,0.08)", border: "1px solid #ef4444",
            cursor: "pointer", textAlign: "left", width: "100%",
            fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, sans-serif",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <AlertTriangle style={{ width: 22, height: 22, color: "#ef4444", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#ef4444", letterSpacing: "-0.1px" }}>Action Required!</p>
            <p style={{ fontSize: 13, color: "#222222", marginTop: 2, lineHeight: 1.35 }}>
              Missing: <b>{missingFinancialFields.join(", ")}</b>. Tap here to add them so you can be paid correctly.
            </p>
          </div>
          <ChevronRight style={{ width: 18, height: 18, color: "#ef4444", flexShrink: 0 }} />
        </button>
      )}

      {/* Greeting */}
      <div>
        <p style={{ fontSize: 13, color: "#6a6a6a", marginBottom: 2 }}>Good {getGreeting()},</p>
        <h2
          data-testid="text-employee-name"
          style={{ fontSize: 26, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px", lineHeight: 1.2 }}
        >
          {displayName}
        </h2>
      </div>

      {/* Sub-tab row — bottom-border style */}
      <div style={{ display: "flex", borderBottom: "1px solid #c1c1c1", background: "#ffffff" }}>
        {([
          { id: "myDay", label: "My Day", icon: Home },
          { id: "shopping", label: "Shopping", icon: ShoppingCart },
          { id: "storage", label: "Storage", icon: Package },
        ] as { id: HomeSubTab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => {
          const isActive = homeSubTab === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`button-home-subtab-${id}`}
              onClick={() => setHomeSubTab(id)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 15,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#222222" : "#6a6a6a",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #222222" : "2px solid transparent",
                cursor: "pointer",
                transition: "color 160ms, border-color 160ms",
                fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, sans-serif",
              }}
            >
              <Icon style={{ width: 16, height: 16 }} />
              {label}
            </button>
          );
        })}
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
          <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#ef4444" }} />
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a" }}>
            Today · {fmtLongDate(today)}
          </h3>
        </div>

        {/* Pending-timesheet reminder banner */}
        {pendingTimesheetCount > 0 && (
          <div
            data-testid="banner-pending-timesheet"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", marginBottom: 12, borderRadius: 12,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.4)",
            }}
          >
            <AlertCircle style={{ width: 18, height: 18, color: "#ef4444", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "#222222", lineHeight: 1.35, margin: 0 }}>
              <b>{pendingTimesheetCount} shift{pendingTimesheetCount > 1 ? "s" : ""}</b> still need a timesheet today.
              Tap <b>Submit Timesheet</b> on the card below before you leave.
            </p>
          </div>
        )}

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
        <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a", marginBottom: 12 }}>
          Quick Actions
        </h3>
        <div style={{
          background: "#fff",
          borderRadius: 20,
          boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
        }}>
          <button
            type="button"
            data-testid="button-daily-close-report"
            className="w-full flex items-center gap-4 text-left"
            style={{ padding: "16px 20px", background: "transparent", border: "none", cursor: "pointer", borderRadius: 20 }}
            onClick={() => navigate("/m/daily-close")}
          >
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "#f2f2f2",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <FileText style={{ width: 18, height: 18, color: "#222222" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontWeight: 600, fontSize: 17, color: "#222222" }}>Submit Daily Close Report</p>
              <p style={{ fontSize: 14, color: "#6a6a6a", marginTop: 2 }}>End-of-day summary for managers</p>
            </div>
            <ChevronRight style={{ width: 16, height: 16, color: "#aaa", flexShrink: 0 }} />
          </button>
        </div>
      </div>

      {/* Notices — dismissible per-device via localStorage. Dismissed IDs are
          remembered across sessions so read notices don't re-appear forever. */}
      {(() => {
        const visibleNotices = portalNotices.filter(n => !dismissedNoticeIds.has(n.id));
        if (visibleNotices.length === 0) return null;
        return (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Megaphone style={{ width: 14, height: 14, color: "#6a6a6a" }} />
              <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a" }}>
                Notices
              </h3>
            </div>
            <div className="flex flex-col gap-3">
              {visibleNotices.map(n => (
                <div
                  key={n.id}
                  data-testid={`card-portal-notice-${n.id}`}
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
                    padding: "14px 16px",
                    position: "relative",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => dismissNotice(n.id)}
                    data-testid={`button-dismiss-notice-${n.id}`}
                    aria-label="Mark as read"
                    style={{
                      position: "absolute", top: 10, right: 10,
                      width: 28, height: 28, borderRadius: "50%",
                      background: "transparent", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", color: "#6a6a6a",
                      touchAction: "manipulation",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <X style={{ width: 16, height: 16 }} />
                  </button>
                  <div className="flex flex-wrap items-center gap-2 mb-1.5" style={{ paddingRight: 32 }}>
                    <p style={{ fontWeight: 600, fontSize: 14, color: "#222222", lineHeight: 1.3 }}>{n.title}</p>
                    {!n.targetStoreId && (
                      <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: "#6a6a6a" }}>
                        <Globe style={{ width: 12, height: 12 }} /> All Stores
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: "#6a6a6a", whiteSpace: "pre-line", lineHeight: 1.55 }}>
                    {n.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
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


function WeekRow({ day, today, employeeId, onSubmitted, openCycleStart }: { day: DayData; today: string; employeeId: string; onSubmitted: () => void; openCycleStart: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { abbr, num } = fmtDay(day.date);
  const isToday = day.date === today;
  const isPast  = day.date < today;
  const shifts = day.shifts ?? (day.shift ? [day.shift] : []);
  const hasShift = shifts.length > 0;
  // Timesheet lookup per shift (match by storeId first, else legacy single timesheet)
  const tsByStore = new Map<string, TimesheetInfo>();
  (day.timesheets ?? []).forEach(t => { tsByStore.set((t as any).storeId ?? "", t); });
  const allSubmitted = hasShift && shifts.every(s => tsByStore.has(s.storeId) || (day.timesheets?.length ?? 0) > 0);
  const anyMissing = hasShift && !allSubmitted;
  // Allow logging past shifts within the current open payroll cycle.
  const canLogPast = isPast && hasShift && anyMissing && day.date >= openCycleStart;

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

        {/* Shift info — one line per shift, coloured by store */}
        <div className="flex-1 min-w-0">
          {hasShift ? (
            <div className="flex flex-col gap-1">
              {shifts.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: s.storeColor ?? "#6a6a6a" }}
                    aria-label={s.storeName ?? ""}
                  />
                  <span className={`font-semibold text-sm tabular-nums ${
                    !isToday && isPast ? "text-muted-foreground" :
                    !isToday && !isPast ? "" : ""
                  }`} style={{ color: s.storeColor ?? undefined }}>
                    {s.startTime} – {s.endTime}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {calcHours(s.startTime, s.endTime).toFixed(1)}h
                  </span>
                  {s.storeName && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-auto">
                      {s.storeName}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/40 italic">Day off</p>
          )}
        </div>

        {/* Status badge / Log prompt */}
        <div className="shrink-0">
          {allSubmitted && (day.timesheets?.[0] || day.timesheet) && (() => {
            const ts = day.timesheets?.[0] ?? day.timesheet!;
            const st = STATUS_STYLE[ts.status] ?? STATUS_STYLE.PENDING;
            return (
              <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${st.bg}`}>
                <CheckCircle2 className={`h-3 w-3 ${st.text}`} />
                <span className={`text-xs font-medium ${st.text}`}>{st.label.split(" ")[0]}</span>
              </div>
            );
          })()}
          {canLogPast && (
            <span className="text-xs text-primary font-medium">Log</span>
          )}
          {hasShift && !allSubmitted && !isPast && (
            <span className="text-xs text-muted-foreground/40">–</span>
          )}
        </div>
      </div>

      {canLogPast && (() => {
        // Reuse the polished TimesheetDrawer (the same sheet used on the
        // dashboard's TodayShiftCard) instead of the older custom modal.
        // Pick the first shift that doesn't yet have a timesheet for the day;
        // fall back to the first shift if none match.
        const targetShift = shifts.find(s => !tsByStore.has(s.storeId)) ?? shifts[0];
        const item: TodayShiftItem = {
          shift: targetShift,
          storeName: targetShift.storeName ?? "",
          storeColor: targetShift.storeColor ?? "#6a6a6a",
          timesheet: null,
        };
        return (
          <TimesheetDrawer
            open={drawerOpen}
            employeeId={employeeId}
            item={item}
            onClose={() => setDrawerOpen(false)}
            onSubmitted={() => onSubmitted()}
          />
        );
      })()}
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
    refetchInterval: 30_000,
  });

  const days = weekData?.days ?? [];
  // Count individual shifts (a day can hold multiple — e.g. Sushi + Sandwich).
  const allShifts = days.flatMap(d => d.shifts ?? (d.shift ? [d.shift] : []));
  const totalShiftCount = allShifts.length;
  const totalHours = allShifts.reduce((sum, s) => sum + calcHours(s.startTime, s.endTime), 0);
  const submitted = days.reduce((sum, d) => sum + (d.timesheets?.length ?? (d.timesheet ? 1 : 0)), 0);
  const shiftDays = days.filter(d => (d.shifts?.length ?? (d.shift ? 1 : 0)) > 0);

  const A = {
    font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
    shadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "20px 16px", background: "#ffffff", minHeight: "100%", fontFamily: A.font }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px", lineHeight: 1.18 }}>My Schedule</h2>
        <p style={{ fontSize: 13, color: "#6a6a6a", marginTop: 3 }}>Your weekly shift roster</p>
      </div>

      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          data-testid="button-prev-week"
          onClick={() => setWeekStart(s => addDays(s, -7))}
          style={{ width: 36, height: 36, borderRadius: "50%", background: "#f2f2f2", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft style={{ width: 16, height: 16, color: "#222222" }} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#222222" }}>{fmtWeekRange(weekStart)}</span>
        <button
          type="button"
          data-testid="button-next-week"
          onClick={() => setWeekStart(s => addDays(s, 7))}
          disabled={isCurrentWeek}
          style={{ width: 36, height: 36, borderRadius: "50%", background: "#f2f2f2", border: "none", cursor: isCurrentWeek ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: isCurrentWeek ? 0.3 : 1 }}
        >
          <ChevronRight style={{ width: 16, height: 16, color: "#222222" }} />
        </button>
      </div>

      {/* Summary strip */}
      {!isLoading && weekData?.published && totalShiftCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderRadius: 8, border: "1px solid #c1c1c1" }}>
          <span style={{ fontSize: 13, color: "#6a6a6a" }}>
            <span style={{ fontWeight: 600, color: "#222222" }}>{totalShiftCount}</span> shifts ·{" "}
            <span style={{ fontWeight: 600, color: "#222222" }}>{totalHours.toFixed(1)}h</span> total
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6a6a6a" }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: submitted >= totalShiftCount ? "#222222" : "#ef4444" }} />
            {submitted}/{totalShiftCount} submitted
          </span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
          <Loader2 style={{ width: 24, height: 24, color: "#6a6a6a", animation: "spin 1s linear infinite" }} className="animate-spin" />
        </div>
      )}

      {/* Not published */}
      {!isLoading && !weekData?.published && (
        <div style={{ background: "#ffffff", borderRadius: 20, padding: "40px 20px", textAlign: "center", boxShadow: A.shadow }}>
          <CalendarDays style={{ width: 32, height: 32, color: "#c1c1c1", margin: "0 auto 8px" }} />
          <p style={{ fontWeight: 600, fontSize: 15, color: "#222222", marginBottom: 4 }}>Roster not published yet</p>
          <p style={{ fontSize: 13, color: "#6a6a6a" }}>Check back once the manager publishes the week's roster.</p>
        </div>
      )}

      {/* Days list */}
      {!isLoading && weekData?.published && (
        <div style={{ background: "#ffffff", borderRadius: 20, boxShadow: A.shadow, overflow: "hidden" }}>
          {days.map((day, i) => (
            <div key={day.date} style={{ borderTop: i === 0 ? "none" : "1px solid #c1c1c1" }}>
              <WeekRow
                day={day}
                today={today}
                employeeId={session.id}
                onSubmitted={() => qc.invalidateQueries({ queryKey: weekQK })}
                openCycleStart={openCycleStart}
              />
            </div>
          ))}
        </div>
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
  const historyQK = ["/api/portal/history", session.id];
  const { data: rawCycles = [], isLoading } = useQuery<HistoryCycle[]>({
    queryKey: historyQK,
    queryFn: async () => {
      const res = await fetch(`/api/portal/history?employeeId=${session.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 0,
  });

  // Latest first
  const cycles = [...rawCycles].sort((a, b) => b.cycleStart.localeCompare(a.cycleStart));

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-8" style={{ background: "#ffffff", minHeight: "100%", fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, Roboto, 'Helvetica Neue', sans-serif" }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px" }}>My Timesheets</h2>
        <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>History by pay cycle</p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1].map(i => (
            <div key={i} style={{ background: "#fff", borderRadius: 20, padding: "18px 20px",
              boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px" }}>
              <div className="h-4 bg-muted rounded animate-pulse w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && cycles.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 20, padding: "32px 20px", textAlign: "center",
          boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px" }}>
          <ListChecks style={{ width: 32, height: 32, color: "#ccc", margin: "0 auto 8px" }} />
          <p style={{ fontSize: 13, color: "#6a6a6a" }}>No timesheet history yet.</p>
        </div>
      )}

      {cycles.map(cycle => {
        const rangeStr = fmtCycleRange(cycle.cycleStart, cycle.cycleEnd);
        const totalHours = cycle.entries.reduce((sum, e) => {
          if (!e.timesheet) return sum;
          return sum + calcHours(e.timesheet.actualStartTime, e.timesheet.actualEndTime);
        }, 0);
        const isPaid = cycle.cycleStatus === "PAID";
        const isApproved = cycle.cycleStatus === "APPROVED" || isPaid;
        const isProgressing = cycle.cycleStatus === "PENDING";

        return (
          <div
            key={cycle.cycleStart}
            data-testid={`card-cycle-${cycle.cycleStart}`}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "18px 20px",
              boxShadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 15, color: "#222222" }}>{rangeStr}</p>
                {totalHours > 0 && (
                  <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 3 }}>{totalHours.toFixed(1)} hrs total</p>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {isProgressing && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                    background: "#fff7ed", color: "#c2410c",
                  }}>Progressing</span>
                )}
                {isApproved && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                    background: "#eff6ff", color: "#1d4ed8",
                  }}>Approved</span>
                )}
                {isPaid && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                    background: "#f0fdf4", color: "#15803d",
                  }}>Paid</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
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

// Phase B: ADMIN/MANAGER/STAFF self-service password change inside the portal
// Edit Profile page. EMPLOYEE-role users (PIN only) don't see this — they have
// no admin password to change. POST /api/auth/change-password verifies the
// current password and force-logs-out every session for the user, so after a
// successful change we redirect them to the portal home (PIN re-entry is
// required for the next session).
function AdminPasswordSelfService({ session }: { session: Session }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const role = (session.role ?? "").toUpperCase();
  const isAdminTier = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  if (!isAdminTier) return null;

  async function handleSubmit() {
    if (!current || !next || !confirm) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    if (next.length < 8) {
      toast({ title: "Password too short", description: "Minimum 8 characters.", variant: "destructive" });
      return;
    }
    if (next !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Failed",
          description: data?.message ?? "Could not change password",
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }
      // Server force-logged-out every session for this employee, including
      // the current PIN session. Clear local tokens so we don't keep firing
      // 401s, then send the user back to the portal entry (PIN screen).
      try {
        localStorage.removeItem("ep_portal_token_v1");
        localStorage.removeItem("admin_token_v1");
      } catch {}
      toast({
        title: "Password updated",
        description: "Sign in again with your new password.",
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setTimeout(() => {
        window.location.href = "/m/portal";
      }, 800);
    } catch (err: any) {
      toast({
        title: "Network error",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <KeyRound className="h-4 w-4 text-primary" />
        </div>
        <h3 className="font-semibold text-sm">Admin Login Password</h3>
      </div>
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            매니저·어드민 페이지 로그인용 비밀번호. 변경 시 모든 기기에서 로그아웃됩니다.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Current password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-11 text-base"
              data-testid="input-current-password"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">New password (8+)</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-11 text-base"
              data-testid="input-new-password"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Confirm new password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 text-base"
              data-testid="input-confirm-password"
              disabled={submitting}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleSubmit}
            disabled={submitting || !current || !next || !confirm}
            className="h-11"
            data-testid="button-change-admin-password"
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
            {submitting ? "Updating..." : "Change Password"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

function EditProfileView({ session, onBack }: { session: Session; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // File input refs
  const fhcFileRef = useRef<HTMLInputElement>(null);
  const selfieFileRef = useRef<HTMLInputElement>(null);
  const passportFileRef = useRef<HTMLInputElement>(null);

  const [fhcUploading, setFhcUploading] = useState(false);
  const [selfieUploading, setSelfieUploading] = useState(false);
  const [passportUploading, setPassportUploading] = useState(false);

  const { data: employee, isLoading } = useQuery<any>({
    queryKey: ["/api/employees", session.id],
    queryFn: () => fetch(`/api/employees/${session.id}`).then(r => r.json()),
    staleTime: 0,
  });

  const DRAFT_KEY = `ep_profile_draft_${session.id}`;
  const [form, setForm] = useState<ProfileFormData>({
    email: "", streetAddress: "", streetAddress2: "", suburb: "", state: "", postCode: "",
    selfieUrl: "", passportUrl: "", fhc: "", tfn: "", bsb: "", accountNo: "",
    superCompany: "", superMembershipNo: "",
  });
  const [bsbError, setBsbError] = useState("");
  const [hasDraft, setHasDraft] = useState(false);

  // On mount: load saved employee OR locally-saved draft (whichever exists).
  // Drafts survive accidental navigation (tap Home mid-edit, swipe browser
  // back, phone dies etc.) so the user doesn't lose 2 minutes of typing.
  useEffect(() => {
    if (!employee) return;
    const serverValues: ProfileFormData = {
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
    };
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as ProfileFormData;
        // Field-by-field merge: draft wins ONLY where it has typed content
        // (non-empty string). Empty draft fields fall back to server. This
        // preserves the user's in-progress edits while still surfacing newer
        // server-side data (e.g., admin filled in TFN on desktop after the
        // user opened the form). Previous logic blindly preferred draft and
        // hid server-newer fields if any single field differed.
        const merged: ProfileFormData = { ...serverValues };
        let hasUnsavedEdits = false;
        for (const k of Object.keys(serverValues) as (keyof ProfileFormData)[]) {
          const draftVal = (draft as any)[k];
          if (draftVal !== undefined && draftVal !== null && String(draftVal).trim() !== "") {
            if (draftVal !== (serverValues as any)[k]) {
              (merged as any)[k] = draftVal;
              hasUnsavedEdits = true;
            }
          }
        }
        setForm(merged);
        setHasDraft(hasUnsavedEdits);
        return;
      }
    } catch {}
    setForm(serverValues);
  }, [employee, DRAFT_KEY]);

  // Persist form edits to localStorage on every change so a crash / reload
  // doesn't wipe the work-in-progress.
  useEffect(() => {
    if (!employee) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {}
  }, [form, employee, DRAFT_KEY]);

  // Warn on page close / reload if the draft is unsaved.
  useEffect(() => {
    if (!hasDraft) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDraft]);

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
      // Clear the saved draft now that the server holds the truth.
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setHasDraft(false);
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
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(f => ({ ...f, [key]: e.target.value }));
      setHasDraft(true);
    },
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
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            if (hasDraft) {
              const ok = window.confirm("You have unsaved changes. Leave without saving?");
              if (!ok) return;
            }
            onBack();
          }}
          data-testid="button-edit-profile-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="font-bold text-base flex-1">
          Edit My Profile
          {hasDraft && <span className="ml-2 text-xs font-medium text-amber-600">• Unsaved</span>}
        </h2>
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
              {/* Single hidden input — native mobile picker offers camera + library */}
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
                    <Button variant="outline" size="sm" onClick={() => selfieFileRef.current?.click()} data-testid="button-selfie-replace">
                      <ImagePlus className="h-4 w-4 mr-1.5" />
                      Replace Photo
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setForm(f => ({ ...f, selfieUrl: "" }))} data-testid="button-selfie-remove">
                      <X className="h-4 w-4 mr-1.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {!selfieUploading && !form.selfieUrl && (
                <Button
                  variant="outline"
                  className="h-16 flex-col gap-1.5"
                  onClick={() => selfieFileRef.current?.click()}
                  data-testid="button-selfie-upload"
                >
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload Photo</span>
                </Button>
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
              {/* Hidden input (native picker on mobile offers camera + library) */}
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
                  <Button variant="outline" size="sm" onClick={() => passportFileRef.current?.click()} data-testid="button-passport-replace">
                    <ImagePlus className="h-4 w-4 mr-1.5" />
                    Replace Photo or PDF
                  </Button>
                </div>
              )}

              {!passportUploading && !form.passportUrl && (
                <Button
                  variant="outline"
                  className="h-16 flex-col gap-1.5"
                  onClick={() => passportFileRef.current?.click()}
                  data-testid="button-passport-upload"
                >
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Upload Photo or PDF</span>
                </Button>
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
                <Label className="text-xs text-muted-foreground">
                  TFN (Tax File Number) <span className="text-destructive font-bold">*</span>
                </Label>
                <Input placeholder="e.g. 123 456 789" {...field("tfn")} data-testid="input-tfn" className="h-11 text-base font-mono" inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  BSB (6 digits) <span className="text-destructive font-bold">*</span>
                </Label>
                <Input
                  placeholder="e.g. 062000 or 062 000"
                  value={form.bsb}
                  onChange={e => {
                    // Accept spaces/dashes but strip them on submit.
                    // maxLength of 9 tolerates "062 000" / "062-000" while
                    // the validator still requires 6 digits after stripping.
                    setForm(f => ({ ...f, bsb: e.target.value }));
                    setBsbError("");
                  }}
                  data-testid="input-bsb"
                  className={`h-11 text-base font-mono ${bsbError ? "border-destructive" : ""}`}
                  inputMode="numeric"
                  maxLength={9}
                />
                {bsbError && <p className="text-xs text-destructive" data-testid="error-bsb">{bsbError}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Account Number <span className="text-destructive font-bold">*</span>
                </Label>
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
                <Label className="text-xs text-muted-foreground">
                  Super Fund Name <span className="text-destructive font-bold">*</span>
                </Label>
                <Input placeholder="e.g. Australian Super, Hostplus" {...field("superCompany")} data-testid="input-super-company" className="h-11 text-base" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Member Number <span className="text-destructive font-bold">*</span>
                </Label>
                <Input placeholder="Your membership number" {...field("superMembershipNo")} data-testid="input-super-membership-no" className="h-11 text-base font-mono" />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Admin password (manager/staff/admin self-service) ─── */}
        <AdminPasswordSelfService session={session} />

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

// ── Change PIN Drawer ──────────────────────────────────────────────────────────

type ChangePinStep = "current" | "new" | "confirm";

function ChangePinDrawer({ open, onClose, employeeId, required = false, onChanged }: { open: boolean; onClose: () => void; employeeId: string; required?: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<ChangePinStep>("current");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  // Refs always hold the latest PIN values so setTimeout callbacks never read stale closures
  const currentPinRef = useRef("");
  const newPinRef = useRef("");

  const resetAll = () => {
    setStep("current");
    setCurrentPin(""); currentPinRef.current = "";
    setNewPin(""); newPinRef.current = "";
    setConfirmPin("");
    setError("");
  };

  const handleClose = () => { resetAll(); onClose(); };

  const changePinMutation = useMutation({
    mutationFn: async ({ current, next }: { current: string; next: string }) => {
      const res = await fetch("/api/portal/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, currentPin: current, newPin: next }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed to change PIN"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "PIN changed successfully" });
      onChanged?.();
      handleClose();
    },
    onError: (err: Error) => {
      currentPinRef.current = "";
      newPinRef.current = "";
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setStep("current");
      setError(err.message);
    },
  });

  const activePin = step === "current" ? currentPin : step === "new" ? newPin : confirmPin;

  // Use functional setState so rapid taps accumulate correctly even before re-render
  const handleDigit = (d: string) => {
    if (changePinMutation.isPending) return;
    setError("");
    if (step === "current") {
      setCurrentPin(prev => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        currentPinRef.current = next;
        if (next.length === 4) setTimeout(() => setStep("new"), 200);
        return next;
      });
    } else if (step === "new") {
      setNewPin(prev => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        newPinRef.current = next;
        if (next.length === 4) setTimeout(() => setStep("confirm"), 200);
        return next;
      });
    } else {
      setConfirmPin(prev => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        if (next.length === 4) {
          setTimeout(() => {
            const curPin = currentPinRef.current;
            const nwPin = newPinRef.current;
            // ── Weak-PIN checks ──
            // Sequential ascending/descending (e.g. 1234, 4321, 0123, 9876)
            const isSequential = (p: string) => {
              const diffs = [1, 2, 3].map(i => p.charCodeAt(i) - p.charCodeAt(i - 1));
              return diffs.every(d => d === 1) || diffs.every(d => d === -1);
            };
            // All same digit (1111, 2222 …)
            const isRepeated = (p: string) => /^(\d)\1{3}$/.test(p);
            // How many digits differ between new and current
            const digitsDifferent = (a: string, b: string) =>
              [0, 1, 2, 3].filter(i => a[i] !== b[i]).length;
            const reject = (msg: string) => {
              setError(msg);
              newPinRef.current = "";
              setNewPin("");
              setConfirmPin("");
              setTimeout(() => setStep("new"), 100);
            };
            if (next !== nwPin) {
              reject("PINs do not match. Please try again.");
            } else if (next === curPin) {
              reject("New PIN must be different from your current PIN.");
            } else if (digitsDifferent(next, curPin) < 2) {
              reject("New PIN must differ from the current PIN by at least 2 digits.");
            } else if (isRepeated(next)) {
              reject("PIN too weak — avoid the same digit four times (like 1111).");
            } else if (isSequential(next)) {
              reject("PIN too weak — avoid sequential digits (like 1234 or 4321).");
            } else {
              changePinMutation.mutate({ current: curPin, next });
            }
          }, 80);
        }
        return next;
      });
    }
  };

  const handleDel = () => {
    setError("");
    if (step === "current") { setCurrentPin(p => { const v = p.slice(0, -1); currentPinRef.current = v; return v; }); }
    else if (step === "new") { setNewPin(p => { const v = p.slice(0, -1); newPinRef.current = v; return v; }); }
    else setConfirmPin(p => p.slice(0, -1));
  };

  const stepLabel: Record<ChangePinStep, string> = {
    current: "Enter your current PIN",
    new: "Enter your new 4-digit PIN",
    confirm: "Confirm your new PIN",
  };

  return (
    <Drawer open={open} onOpenChange={o => { if (!o) handleClose(); }}>
      <DrawerContent className="px-4 max-w-md mx-auto">
        <DrawerHeader className="pb-2">
          <DrawerTitle>{required ? "Set a New PIN (Recommended)" : "Change PIN"}</DrawerTitle>
          <p className="text-sm text-muted-foreground">
            {required
              ? "For your security, choose a new 4-digit PIN. You can skip for now and do this later from Settings."
              : "Enter your current PIN, then choose a new 4-digit PIN"}
          </p>
        </DrawerHeader>

        <div className="flex flex-col items-center gap-5 py-4">
          <p className="text-sm font-medium text-center">{stepLabel[step]}</p>

          {/* PIN dots */}
          <div className="flex gap-6">
            {[0,1,2,3].map(i => (
              <div key={i} className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                i < activePin.length ? "bg-foreground border-foreground scale-110" : "border-muted-foreground/50"
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
            {changePinMutation.isPending && (
              <div className="flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Numpad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 320 }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => {
              const isPressed = pressedKey === `${idx}`;
              const isDel = key === "⌫";
              const isEmpty = key === "";
              return (
                <button
                  key={idx} type="button"
                  disabled={changePinMutation.isPending || isEmpty}
                  data-testid={isDel ? "changepin-delete" : key ? `changepin-digit-${key}` : undefined}
                  onPointerDown={(e) => {
                    if (isEmpty || changePinMutation.isPending) return;
                    e.preventDefault();
                    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                    setPressedKey(`${idx}`);
                    if (isDel) handleDel();
                    else handleDigit(key);
                  }}
                  onPointerUp={() => setPressedKey(null)}
                  onPointerCancel={() => setPressedKey(null)}
                  onPointerLeave={() => setPressedKey(null)}
                  style={{
                    height: 72,
                    borderRadius: 16,
                    border: "none",
                    cursor: isEmpty ? "default" : "pointer",
                    visibility: isEmpty ? "hidden" : "visible",
                    background: isDel
                      ? (isPressed ? "rgba(239,68,68,0.12)" : "transparent")
                      : (isPressed ? "rgba(239,68,68,0.15)" : "#f2f2f2"),
                    color: isPressed ? "#ef4444" : (isDel ? "#6a6a6a" : "#222222"),
                    transform: isPressed ? "scale(0.96)" : "scale(1)",
                    fontSize: 24,
                    fontWeight: 600,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    transition: "background 80ms, color 80ms, transform 80ms",
                    fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, sans-serif",
                  }}
                >{key}</button>
              );
            })}
          </div>
        </div>

        <DrawerFooter className="pb-6">
          <Button
            variant="outline"
            onClick={handleClose}
            data-testid={required ? "button-changepin-skip" : "button-changepin-cancel"}
          >
            {required ? "Skip for now" : "Cancel"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ── Tab: Settings ─────────────────────────────────────────────────────────────

function SettingsTab({ session, onLogout, onEditProfile }: { session: Session; onLogout: () => void; onEditProfile: () => void }) {
  const displayName = session.nickname || session.firstName;
  const [changePinOpen, setChangePinOpen] = useState(false);

  const A = {
    font: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, 'Helvetica Neue', sans-serif",
    shadow: "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "20px 16px", background: "#ffffff", minHeight: "100%", fontFamily: A.font }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#222222", letterSpacing: "-0.44px", lineHeight: 1.18 }}>Settings</h2>
        <p style={{ fontSize: 13, color: "#6a6a6a", marginTop: 3 }}>Manage your account</p>
      </div>

      {/* User info card */}
      <div style={{ background: "#ffffff", borderRadius: 20, padding: "16px 20px", boxShadow: A.shadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {session.selfieUrl ? (
            <img
              src={session.selfieUrl}
              alt={displayName}
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid #c1c1c1" }}
            />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#f2f2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <User style={{ width: 28, height: 28, color: "#222222" }} />
            </div>
          )}
          <div>
            <p data-testid="text-settings-name" style={{ fontWeight: 600, fontSize: 16, color: "#222222" }}>{displayName}</p>
            <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>{session.firstName} · Staff</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6a6a6a", paddingLeft: 4, marginBottom: 4 }}>Account</p>
        <div style={{ background: "#ffffff", borderRadius: 20, boxShadow: A.shadow, overflow: "hidden" }}>
          {/* Edit My Profile */}
          <button
            type="button"
            data-testid="button-edit-profile"
            onClick={onEditProfile}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", background: "transparent", border: "none", borderBottom: "1px solid #c1c1c1", cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f2f2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <PenLine style={{ width: 18, height: 18, color: "#222222" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 14, color: "#222222" }}>Edit My Profile</p>
              <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>Update address, visa, bank &amp; super details</p>
            </div>
            <ChevronRight style={{ width: 16, height: 16, color: "#6a6a6a", flexShrink: 0 }} />
          </button>
          {/* Change PIN */}
          <button
            type="button"
            data-testid="button-change-pin"
            onClick={() => setChangePinOpen(true)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#f2f2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <KeyRound style={{ width: 18, height: 18, color: "#222222" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 14, color: "#222222" }}>Change PIN</p>
              <p style={{ fontSize: 12, color: "#6a6a6a", marginTop: 2 }}>Default: last 4 digits of your phone</p>
            </div>
            <ChevronRight style={{ width: 16, height: 16, color: "#6a6a6a", flexShrink: 0 }} />
          </button>
        </div>
      </div>

      {/* Log out */}
      <div style={{ paddingTop: 8 }}>
        <button
          type="button"
          data-testid="button-logout"
          onClick={onLogout}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 24px", background: "#222222", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 500, cursor: "pointer", fontFamily: A.font }}
        >
          <LogOut style={{ width: 16, height: 16 }} />
          Log Out
        </button>
      </div>

      <ChangePinDrawer
        open={changePinOpen}
        onClose={() => setChangePinOpen(false)}
        employeeId={session.id}
      />
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
    <nav
      className="shrink-0 z-50 w-full"
      style={{
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid #c1c1c1",
        paddingBottom: "env(safe-area-inset-bottom)",
        fontFamily: "'Airbnb Cereal VF', Circular, -apple-system, system-ui, sans-serif",
      }}
    >
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
                style={{ width: 24, height: 24, color: isActive ? "#222222" : "#6a6a6a", transition: "color 160ms" }}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: "0.02em",
                  color: isActive ? "#222222" : "#6a6a6a",
                  transition: "color 160ms",
                }}
              >{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Logged-in App Shell ───────────────────────────────────────────────────────

function AppShell({
  session, onLogout, activeTab, setActiveTab, subView, setSubView, onPinChanged,
}: {
  session: Session;
  onLogout: () => void;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  subView: "edit-profile" | null;
  setSubView: (v: "edit-profile" | null) => void;
  onPinChanged: () => void;
}) {
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
        {activeTab === "home"       && <HomeTab session={session} onEditProfile={() => setSubView("edit-profile")} />}
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

      {/* First-login reminder: user may set a new PIN now or skip to later.
          Skipping clears the local flag so the modal doesn't keep re-opening
          this session. They can change the PIN from Settings whenever. */}
      <ChangePinDrawer
        open={!!session.isFirstLogin}
        required
        employeeId={session.id}
        onClose={onPinChanged}
        onChanged={onPinChanged}
      />
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

export function EmployeePortal() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  useEffect(() => { saveSession(session); }, [session]);

  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [subView, setSubView] = useState<"edit-profile" | null>(null);

  const handleLogout = () => {
    // Best-effort: invalidate the bearer token server-side, then clear local
    // copy. We do this before setSession(null) so the fetch still picks up
    // the token from localStorage.
    try {
      fetch("/api/portal/logout", { method: "POST" }).catch(() => {});
    } catch {}
    try { localStorage.removeItem("ep_portal_token_v1"); } catch {}
    setSession(null);
  };
  const handleLogin  = (s: Session) => { saveSession(s); setSession(s); };
  const handlePinChanged = () => setSession(s => s ? { ...s, isFirstLogin: false } : s);
  const showBack = !!session && (subView !== null || activeTab !== "home");
  const handleBack = () => {
    if (subView) setSubView(null);
    else setActiveTab("home");
  };

  const roleUpper = session?.role?.toUpperCase();
  const { data: headerPermissions = [] } = useQuery<Array<{ role: string; route: string; allowed: boolean }>>({
    queryKey: ["/api/permissions"],
    enabled: roleUpper === "MANAGER",
    staleTime: 60_000,
  });
  const showAdminDashboard =
    !!session && (
      roleUpper === "OWNER" ||
      roleUpper === "ADMIN" ||
      (roleUpper === "MANAGER" && headerPermissions.some(p => p.role === "MANAGER" && p.allowed)) ||
      (roleUpper === "STAFF" && headerPermissions.some(p => p.role === "STAFF" && p.allowed))
    );

  return (
    <div style={{ height: "100dvh", overflow: "hidden", background: "#ffffff", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: AL.font }}>
      <div style={{ width: "100%", maxWidth: 448, height: "100%", display: "flex", flexDirection: "column", borderLeft: "1px solid #c1c1c1", borderRight: "1px solid #c1c1c1" }}>
        {/* Top bar */}
        <header style={{ flexShrink: 0, zIndex: 50, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid #c1c1c1", paddingTop: "env(safe-area-inset-top)" }}>
          <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
            {showBack && (
              <button
                type="button"
                onClick={handleBack}
                data-testid="button-header-back"
                style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "#f2f2f2", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <ArrowLeft style={{ width: 18, height: 18, color: "#222222" }} />
              </button>
            )}
            <span style={{ fontWeight: 600, fontSize: 15, color: "#222222", letterSpacing: "-0.1px", fontFamily: AL.font }}>Staff Portal</span>

            {/* Right cluster: optional Dashboard button + the two store logos */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {showAdminDashboard && (
                <button
                  type="button"
                  data-testid="button-admin-dashboard-header"
                  onClick={() => {
                    // Phase B: AdminRoleContext sources role from AuthContext now.
                    // If the user has an admin_token_v1 (logged-in admin), they go
                    // straight to /admin; otherwise RequireAuth redirects to /admin/login.
                    window.location.href = "/admin";
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    height: 32, padding: "0 12px",
                    background: "#222222", color: "#ffffff",
                    border: "none", borderRadius: 8,
                    fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: AL.font,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <LayoutDashboard style={{ width: 14, height: 14 }} />
                  Dashboard
                </button>
              )}
              <div style={{ position: "relative", overflow: "hidden", width: 28, height: 28, flexShrink: 0 }}>
                <img
                  src={sushimeLogo}
                  alt="Sushime"
                  data-testid="img-header-logo-sushime"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: "scale(2.8)", transformOrigin: "center" }}
                />
              </div>
              <div style={{ width: 1, height: 18, background: "#c1c1c1", flexShrink: 0 }} />
              <div style={{ position: "relative", overflow: "hidden", width: 44, height: 24, flexShrink: 0 }}>
                <img
                  src={eatemLogo}
                  alt="Eat'em"
                  data-testid="img-header-logo-eatem"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: "scale(1.9)", transformOrigin: "center" }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main content fills remaining height */}
        {session
          ? <AppShell
              session={session}
              onLogout={handleLogout}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              subView={subView}
              setSubView={setSubView}
              onPinChanged={handlePinChanged}
            />
          : <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
              <PinLogin onSuccess={handleLogin} />
            </div>
        }
      </div>
    </div>
  );
}
