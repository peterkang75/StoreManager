import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Repeat } from "lucide-react";
import type { AutomationRule } from "@shared/schema";

type EnrichedRule = AutomationRule & { employeeName: string | null; storeName: string | null };

const ACTION_TYPE_LABELS: Record<string, string> = {
  ROSTER: "Roster",
  PAYROLL_ADJUSTMENT: "Payroll Adj.",
  FINANCE_TRANSFER: "Finance Transfer",
};

const FREQ_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY_FIRST_WEEK: "Monthly (1st Week)",
  MONTHLY: "Monthly (1st)",
};

const DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const ACTION_BADGE_CLASS: Record<string, string> = {
  ROSTER: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  PAYROLL_ADJUSTMENT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  FINANCE_TRANSFER: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

interface RuleForm {
  title: string;
  actionType: string;
  frequency: string;
  daysOfWeek: number[];
  targetEmployeeId: string;
  targetStoreId: string;
  description: string;
  isActive: boolean;
  // Payload fields
  rosterStoreId: string;
  rosterStartTime: string;
  rosterEndTime: string;
  payrollAmount: string;
  payrollReason: string;
  transferFromStoreId: string;
  transferToStoreId: string;
  transferAmount: string;
  transferType: string;
}

const defaultForm: RuleForm = {
  title: "",
  actionType: "ROSTER",
  frequency: "WEEKLY",
  daysOfWeek: [1, 2, 3, 4, 5],
  targetEmployeeId: "",
  targetStoreId: "",
  description: "",
  isActive: true,
  rosterStoreId: "",
  rosterStartTime: "09:00",
  rosterEndTime: "17:00",
  payrollAmount: "",
  payrollReason: "",
  transferFromStoreId: "",
  transferToStoreId: "",
  transferAmount: "",
  transferType: "convert",
};

function buildPayload(form: RuleForm): Record<string, unknown> {
  if (form.actionType === "ROSTER") {
    return { storeId: form.rosterStoreId, startTime: form.rosterStartTime, endTime: form.rosterEndTime };
  }
  if (form.actionType === "PAYROLL_ADJUSTMENT") {
    return { amount: parseFloat(form.payrollAmount), reason: form.payrollReason };
  }
  if (form.actionType === "FINANCE_TRANSFER") {
    return {
      fromStoreId: form.transferFromStoreId,
      toStoreId: form.transferToStoreId,
      amount: parseFloat(form.transferAmount),
      transferType: form.transferType,
    };
  }
  return {};
}

function ruleToForm(rule: EnrichedRule): RuleForm {
  const p = (rule.payload ?? {}) as Record<string, any>;
  return {
    title: rule.title,
    actionType: rule.actionType,
    frequency: rule.frequency,
    daysOfWeek: rule.daysOfWeek ?? [],
    targetEmployeeId: rule.targetEmployeeId ?? "",
    targetStoreId: rule.targetStoreId ?? "",
    description: rule.description ?? "",
    isActive: rule.isActive,
    rosterStoreId: p.storeId ?? "",
    rosterStartTime: p.startTime ?? "09:00",
    rosterEndTime: p.endTime ?? "17:00",
    payrollAmount: p.amount != null ? String(p.amount) : "",
    payrollReason: p.reason ?? "",
    transferFromStoreId: p.fromStoreId ?? "",
    transferToStoreId: p.toStoreId ?? "",
    transferAmount: p.amount != null ? String(p.amount) : "",
    transferType: p.transferType ?? "convert",
  };
}

type Store = { id: string; name: string };
type Employee = { id: string; name: string };

export function AdminAutomations() {
  const { toast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EnrichedRule | null>(null);
  const [form, setForm] = useState<RuleForm>(defaultForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery<EnrichedRule[]>({
    queryKey: ["/api/automation-rules"],
  });

  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });

  const rosterStores = stores.filter(s =>
    s.name.toLowerCase().includes("sushi") || s.name.toLowerCase().includes("sandwich")
  );

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/automation-rules", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule created" });
      setSheetOpen(false);
    },
    onError: () => toast({ title: "Failed to create rule", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PUT", `/api/automation-rules/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule updated" });
      setSheetOpen(false);
    },
    onError: () => toast({ title: "Failed to update rule", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/automation-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule deleted" });
    },
    onError: () => toast({ title: "Failed to delete rule", variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/automation-rules/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] }),
  });

  function openNew() {
    setEditingRule(null);
    setForm(defaultForm);
    setSheetOpen(true);
  }

  function openEdit(rule: EnrichedRule) {
    setEditingRule(rule);
    setForm(ruleToForm(rule));
    setSheetOpen(true);
  }

  function handleSave() {
    const payload = buildPayload(form);
    const body: Record<string, unknown> = {
      title: form.title,
      actionType: form.actionType,
      frequency: form.frequency,
      daysOfWeek: form.frequency === "WEEKLY" ? form.daysOfWeek : null,
      targetEmployeeId: form.targetEmployeeId || null,
      targetStoreId: form.targetStoreId || null,
      payload,
      description: form.description || null,
      isActive: form.isActive,
    };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: body });
    } else {
      createMutation.mutate(body);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  function toggleDay(day: number) {
    setForm(f => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day)
        ? f.daysOfWeek.filter(d => d !== day)
        : [...f.daysOfWeek, day],
    }));
  }

  function describeTarget(rule: EnrichedRule): string {
    const parts: string[] = [];
    if (rule.employeeName) parts.push(rule.employeeName);
    if (rule.storeName) parts.push(rule.storeName);
    return parts.join(" · ") || "—";
  }

  function describeFreq(rule: EnrichedRule): string {
    const freq = FREQ_LABELS[rule.frequency] ?? rule.frequency;
    if (rule.frequency === "WEEKLY" && rule.daysOfWeek?.length) {
      const dayNames = rule.daysOfWeek
        .sort((a, b) => a - b)
        .map(d => DAYS.find(x => x.value === d)?.label ?? "")
        .join(", ");
      return `${freq} · ${dayNames}`;
    }
    return freq;
  }

  return (
    <AdminLayout title="Automation Rules">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Automation Rules</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              반복 작업을 자동화하여 원클릭으로 실행합니다
            </p>
          </div>
          <Button onClick={openNew} data-testid="button-new-rule">
            <Plus className="w-4 h-4 mr-2" />
            New Rule
          </Button>
        </div>

        {/* Rules list */}
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Repeat className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground font-medium">No automation rules yet</p>
              <p className="text-sm text-muted-foreground">
                Create rules for recurring roster, payroll, or finance tasks.
              </p>
              <Button variant="outline" onClick={openNew} className="mt-2">
                <Plus className="w-4 h-4 mr-2" />
                New Rule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap pb-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base truncate" data-testid={`text-rule-title-${rule.id}`}>
                        {rule.title}
                      </span>
                      <Badge className={ACTION_BADGE_CLASS[rule.actionType] ?? ""} data-testid={`badge-action-${rule.id}`}>
                        {ACTION_TYPE_LABELS[rule.actionType] ?? rule.actionType}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground" data-testid={`text-rule-freq-${rule.id}`}>
                      {describeFreq(rule)}
                    </p>
                    <p className="text-sm text-muted-foreground" data-testid={`text-rule-target-${rule.id}`}>
                      {describeTarget(rule)}
                    </p>
                    {rule.description && (
                      <p className="text-sm text-muted-foreground italic">{rule.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={v => toggleActiveMutation.mutate({ id: rule.id, isActive: v })}
                      data-testid={`switch-active-${rule.id}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(rule)}
                      data-testid={`button-edit-${rule.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteId(rule.id)}
                      data-testid={`button-delete-${rule.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingRule ? "Edit Rule" : "New Automation Rule"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-5 mt-6">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="rule-title">Title *</Label>
              <Input
                id="rule-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Add Peter to roster Tue/Thu"
                data-testid="input-rule-title"
              />
            </div>

            {/* Action Type */}
            <div className="space-y-1.5">
              <Label>Action Type *</Label>
              <Select value={form.actionType} onValueChange={v => setForm(f => ({ ...f, actionType: v }))}>
                <SelectTrigger data-testid="select-action-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROSTER">Roster</SelectItem>
                  <SelectItem value="PAYROLL_ADJUSTMENT">Payroll Adjustment</SelectItem>
                  <SelectItem value="FINANCE_TRANSFER">Finance Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Frequency */}
            <div className="space-y-1.5">
              <Label>Frequency *</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger data-testid="select-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY_FIRST_WEEK">Monthly (First Week)</SelectItem>
                  <SelectItem value="MONTHLY">Monthly (1st of month)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Days of Week — only for WEEKLY */}
            {form.frequency === "WEEKLY" && (
              <div className="space-y-2">
                <Label>Days of Week</Label>
                <div className="flex gap-3 flex-wrap">
                  {DAYS.map(day => (
                    <label key={day.value} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <Checkbox
                        checked={form.daysOfWeek.includes(day.value)}
                        onCheckedChange={() => toggleDay(day.value)}
                        data-testid={`checkbox-day-${day.value}`}
                      />
                      <span className="text-sm">{day.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Target Employee — for ROSTER and PAYROLL_ADJUSTMENT */}
            {(form.actionType === "ROSTER" || form.actionType === "PAYROLL_ADJUSTMENT") && (
              <div className="space-y-1.5">
                <Label>Target Employee</Label>
                <Select
                  value={form.targetEmployeeId}
                  onValueChange={v => setForm(f => ({ ...f, targetEmployeeId: v }))}
                >
                  <SelectTrigger data-testid="select-employee">
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Payload fields by action type */}
            {form.actionType === "ROSTER" && (
              <div className="space-y-4 rounded-md border p-4">
                <p className="text-sm font-medium text-muted-foreground">Roster Details</p>
                <div className="space-y-1.5">
                  <Label>Store</Label>
                  <Select
                    value={form.rosterStoreId}
                    onValueChange={v => setForm(f => ({ ...f, rosterStoreId: v }))}
                  >
                    <SelectTrigger data-testid="select-roster-store">
                      <SelectValue placeholder="Select store..." />
                    </SelectTrigger>
                    <SelectContent>
                      {rosterStores.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={form.rosterStartTime}
                      onChange={e => setForm(f => ({ ...f, rosterStartTime: e.target.value }))}
                      data-testid="input-roster-start"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={form.rosterEndTime}
                      onChange={e => setForm(f => ({ ...f, rosterEndTime: e.target.value }))}
                      data-testid="input-roster-end"
                    />
                  </div>
                </div>
              </div>
            )}

            {form.actionType === "PAYROLL_ADJUSTMENT" && (
              <div className="space-y-4 rounded-md border p-4">
                <p className="text-sm font-medium text-muted-foreground">Payroll Adjustment Details</p>
                <div className="space-y-1.5">
                  <Label>Amount (AUD, can be negative)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.payrollAmount}
                    onChange={e => setForm(f => ({ ...f, payrollAmount: e.target.value }))}
                    placeholder="-401.00"
                    data-testid="input-payroll-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input
                    value={form.payrollReason}
                    onChange={e => setForm(f => ({ ...f, payrollReason: e.target.value }))}
                    placeholder="e.g. Car Finance"
                    data-testid="input-payroll-reason"
                  />
                </div>
              </div>
            )}

            {form.actionType === "FINANCE_TRANSFER" && (
              <div className="space-y-4 rounded-md border p-4">
                <p className="text-sm font-medium text-muted-foreground">Finance Transfer Details</p>
                <div className="space-y-1.5">
                  <Label>From Store</Label>
                  <Select
                    value={form.transferFromStoreId}
                    onValueChange={v => setForm(f => ({ ...f, transferFromStoreId: v }))}
                  >
                    <SelectTrigger data-testid="select-from-store">
                      <SelectValue placeholder="Select store..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>To Store</Label>
                  <Select
                    value={form.transferToStoreId}
                    onValueChange={v => setForm(f => ({ ...f, transferToStoreId: v }))}
                  >
                    <SelectTrigger data-testid="select-to-store">
                      <SelectValue placeholder="Select store..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (AUD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.transferAmount}
                    onChange={e => setForm(f => ({ ...f, transferAmount: e.target.value }))}
                    placeholder="300.00"
                    data-testid="input-transfer-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Transfer Type</Label>
                  <Select
                    value={form.transferType}
                    onValueChange={v => setForm(f => ({ ...f, transferType: v }))}
                  >
                    <SelectTrigger data-testid="select-transfer-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="convert">Convert</SelectItem>
                      <SelectItem value="remittance">Remittance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Additional notes..."
                data-testid="input-description"
              />
            </div>

            {/* Is Active */}
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                data-testid="switch-form-active"
              />
              <Label className="cursor-pointer">Active</Label>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleSave}
                disabled={isSaving || !form.title.trim()}
                data-testid="button-save-rule"
              >
                {isSaving ? "Saving..." : "Save Rule"}
              </Button>
              <Button variant="outline" onClick={() => setSheetOpen(false)} data-testid="button-cancel-rule">
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this automation rule? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) { deleteMutation.mutate(deleteId); setDeleteId(null); } }}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
