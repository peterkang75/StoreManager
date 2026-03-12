import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { CheckCircle2, Clock, CalendarDays, LogOut, ChevronRight, AlertCircle, Loader2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PortalStore {
  id: string;
  name: string;
}

interface PortalEmployee {
  id: string;
  nickname: string | null;
  firstName: string;
  lastName: string;
}

interface Session {
  id: string;
  nickname: string | null;
  firstName: string;
  storeId: string | null;
  selectedStoreId: string;
}

interface ShiftInfo {
  id: string;
  startTime: string;
  endTime: string;
  date: string;
}

interface TimesheetInfo {
  id: string;
  actualStartTime: string;
  actualEndTime: string;
  status: string;
  adjustmentReason: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

// Generate 15-minute time slots
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

// ── Login: Step 1 — Store Selection ──────────────────────────────────────────

function StoreStep({ onSelect }: { onSelect: (store: PortalStore) => void }) {
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
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(stores ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full rounded-md border bg-card p-4 text-left hover-elevate active-elevate-2 flex items-center justify-between"
              data-testid={`portal-store-${s.name.toLowerCase()}`}
              onClick={() => onSelect(s)}
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: s.name === "Sushi" ? "#16a34a" : "#dc2626" }}
                />
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

// ── Login: Step 2 — Employee Selection ───────────────────────────────────────

function EmployeeStep({
  store,
  onSelect,
  onBack,
}: {
  store: PortalStore;
  onSelect: (emp: PortalEmployee) => void;
  onBack: () => void;
}) {
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
        <p className="text-sm text-muted-foreground">Select your name from the list</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : employees?.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-6">No staff with PIN found for this store.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {(employees ?? []).map((e) => (
            <button
              key={e.id}
              type="button"
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
      <Button variant="ghost" size="sm" onClick={onBack} className="mt-1">
        Back
      </Button>
    </div>
  );
}

// ── Login: Step 3 — PIN Entry ─────────────────────────────────────────────────

function PinStep({
  store,
  employee,
  onSuccess,
  onBack,
}: {
  store: PortalStore;
  employee: PortalEmployee;
  onSuccess: (session: Session) => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId: employee.id, pin }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Login failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      onSuccess({ ...data, selectedStoreId: store.id });
    },
    onError: (err: Error) => {
      setError(err.message);
      setPin("");
    },
  });

  const handleDigit = (d: string) => {
    if (pin.length < 4) {
      const next = pin + d;
      setPin(next);
      setError("");
      if (next.length === 4) {
        setTimeout(() => loginMutation.mutate(), 80);
      }
    }
  };

  const handleDelete = () => setPin((p) => p.slice(0, -1));

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <p className="text-xs text-muted-foreground mb-1">{store.name} · {employee.nickname || employee.firstName}</p>
        <h2 className="text-lg font-semibold">Enter your PIN</h2>
      </div>

      {/* PIN dots */}
      <div className="flex justify-center gap-4 py-2" data-testid="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-all ${
              i < pin.length ? "bg-foreground border-foreground" : "border-muted-foreground"
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loginMutation.isPending && (
        <div className="flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key, idx) => (
          <button
            key={idx}
            type="button"
            disabled={loginMutation.isPending || key === ""}
            data-testid={key === "⌫" ? "pin-delete" : key !== "" ? `pin-digit-${key}` : undefined}
            className={`h-14 rounded-md text-xl font-semibold transition-all
              ${key === "" ? "invisible" : "bg-muted hover-elevate active-elevate-2"}
              ${key === "⌫" ? "text-muted-foreground text-base" : ""}
            `}
            onClick={() => key === "⌫" ? handleDelete() : handleDigit(key)}
          >
            {key}
          </button>
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={onBack} disabled={loginMutation.isPending}>
        Back
      </Button>
    </div>
  );
}

// ── Modify Hours Drawer ───────────────────────────────────────────────────────

function ModifyHoursDrawer({
  open,
  shift,
  storeId,
  employeeId,
  date,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  shift: ShiftInfo;
  storeId: string;
  employeeId: string;
  date: string;
  onClose: () => void;
  onSubmitted: (ts: TimesheetInfo) => void;
}) {
  const { toast } = useToast();
  const [startTime, setStartTime] = useState(shift.startTime);
  const [endTime, setEndTime] = useState(shift.endTime);
  const [reason, setReason] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portal/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId,
          employeeId,
          date,
          actualStartTime: startTime,
          actualEndTime: endTime,
          adjustmentReason: reason,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to submit");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Timesheet submitted", description: "Your modified hours have been submitted." });
      onSubmitted(data);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const hours = calcHours(startTime, endTime);

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="px-4">
        <DrawerHeader className="pb-2">
          <DrawerTitle>Modify Hours</DrawerTitle>
          <p className="text-sm text-muted-foreground">
            Rostered: {shift.startTime} – {shift.endTime} ({calcHours(shift.startTime, shift.endTime).toFixed(1)}h)
          </p>
        </DrawerHeader>

        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-start">Actual Start</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="actual-start" data-testid="input-actual-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIME_SLOTS_15.map((t) => (
                    <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="actual-end">Actual End</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger id="actual-end" data-testid="input-actual-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIME_SLOTS_15.map((t) => (
                    <SelectItem key={t} value={t} className="font-mono text-sm">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hours > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              Total: <span className="font-semibold text-foreground">{hours.toFixed(1)}h</span>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">
              Reason for adjustment <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              data-testid="input-adjustment-reason"
              placeholder="e.g. Started 30 mins late due to traffic..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>
        </div>

        <DrawerFooter className="pt-2">
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!reason.trim() || hours <= 0 || submitMutation.isPending}
            data-testid="button-submit-modified"
          >
            {submitMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
            ) : (
              "Submit Modified Hours"
            )}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={submitMutation.isPending}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { toast } = useToast();
  const today = getTodayStr();
  const [showModify, setShowModify] = useState(false);
  const [localTimesheet, setLocalTimesheet] = useState<TimesheetInfo | null>(null);

  const displayName = session.nickname || session.firstName;

  const { data: shiftData, isLoading: shiftLoading } = useQuery<{ shift: ShiftInfo | null; published: boolean }>({
    queryKey: ["/api/portal/shift", session.id, session.selectedStoreId, today],
    queryFn: async () => {
      const res = await fetch(
        `/api/portal/shift?employeeId=${session.id}&storeId=${session.selectedStoreId}&date=${today}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: tsData, isLoading: tsLoading } = useQuery<{ timesheet: TimesheetInfo | null }>({
    queryKey: ["/api/portal/timesheet", session.id, today],
    queryFn: async () => {
      const res = await fetch(`/api/portal/timesheet?employeeId=${session.id}&date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const timesheet = localTimesheet ?? tsData?.timesheet ?? null;
  const shift = shiftData?.shift ?? null;
  const published = shiftData?.published ?? false;

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!shift) throw new Error("No shift found");
      const res = await fetch("/api/portal/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId: session.selectedStoreId,
          employeeId: session.id,
          date: today,
          actualStartTime: shift.startTime,
          actualEndTime: shift.endTime,
          adjustmentReason: null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLocalTimesheet(data);
      toast({ title: "Timesheet confirmed", description: "Your scheduled hours have been submitted." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = shiftLoading || tsLoading;

  const statusColors: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good {getGreeting()},</p>
          <h2 className="text-xl font-bold" data-testid="text-employee-name">{displayName}</h2>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onLogout}
          data-testid="button-logout"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Date */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="h-4 w-4 shrink-0" />
        <span>{fmtDate(today)}</span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* No shift / not published */}
      {!isLoading && (!shift || !published) && (
        <Card data-testid="card-no-shift">
          <CardContent className="py-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-base">No shift today</p>
            <p className="text-sm text-muted-foreground mt-1">
              You have no scheduled shifts for today.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Today's shift card */}
      {!isLoading && shift && published && (
        <Card data-testid="card-today-shift">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Today's Shift</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-shift-time">
                  {shift.startTime} – {shift.endTime}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {calcHours(shift.startTime, shift.endTime).toFixed(1)} hours
                </p>
              </div>
              <div
                className="h-10 w-1.5 rounded-full shrink-0 mt-1"
                style={{ backgroundColor: "#16a34a" }}
              />
            </div>

            {/* Timesheet section */}
            {timesheet ? (
              <div
                className={`mt-3 rounded-md px-3 py-2.5 flex items-center gap-2 ${statusColors[timesheet.status] ?? statusColors.PENDING}`}
                data-testid="badge-timesheet-submitted"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    Timesheet {timesheet.status === "PENDING" ? "Submitted (Pending Approval)" : timesheet.status}
                  </p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {timesheet.actualStartTime} – {timesheet.actualEndTime}
                    {timesheet.adjustmentReason && ` · "${timesheet.adjustmentReason}"`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  className="w-full"
                  style={{ backgroundColor: "#16a34a", borderColor: "#16a34a", color: "white" }}
                  onClick={() => confirmMutation.mutate()}
                  disabled={confirmMutation.isPending}
                  data-testid="button-confirm-hours"
                >
                  {confirmMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Confirm Scheduled Hours
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowModify(true)}
                  disabled={confirmMutation.isPending}
                  data-testid="button-modify-hours"
                >
                  Modify Hours
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modify drawer */}
      {shift && published && showModify && (
        <ModifyHoursDrawer
          open={showModify}
          shift={shift}
          storeId={session.selectedStoreId}
          employeeId={session.id}
          date={today}
          onClose={() => setShowModify(false)}
          onSubmitted={(ts) => setLocalTimesheet(ts)}
        />
      )}
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

type LoginStep = "store" | "employee" | "pin";

export function EmployeePortal() {
  const [step, setStep] = useState<LoginStep>("store");
  const [selectedStore, setSelectedStore] = useState<PortalStore | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<PortalEmployee | null>(null);
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = sessionStorage.getItem("ep_session");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (session) {
      sessionStorage.setItem("ep_session", JSON.stringify(session));
    } else {
      sessionStorage.removeItem("ep_session");
    }
  }, [session]);

  const handleLogout = () => {
    setSession(null);
    setStep("store");
    setSelectedStore(null);
    setSelectedEmployee(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="px-4 py-3 border-b flex items-center gap-2">
        <div
          className="h-6 w-6 rounded-full shrink-0"
          style={{ backgroundColor: selectedStore?.name === "Sandwich" ? "#dc2626" : "#16a34a" }}
        />
        <span className="font-semibold text-sm">
          {selectedStore ? `${selectedStore.name} Portal` : "Staff Portal"}
        </span>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-sm">
          {session ? (
            <Dashboard session={session} onLogout={handleLogout} />
          ) : (
            <div className="bg-card rounded-lg border p-5 shadow-sm">
              {step === "store" && (
                <StoreStep
                  onSelect={(s) => {
                    setSelectedStore(s);
                    setStep("employee");
                  }}
                />
              )}
              {step === "employee" && selectedStore && (
                <EmployeeStep
                  store={selectedStore}
                  onSelect={(e) => {
                    setSelectedEmployee(e);
                    setStep("pin");
                  }}
                  onBack={() => setStep("store")}
                />
              )}
              {step === "pin" && selectedStore && selectedEmployee && (
                <PinStep
                  store={selectedStore}
                  employee={selectedEmployee}
                  onSuccess={(s) => setSession(s)}
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
