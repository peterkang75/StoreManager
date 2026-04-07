import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Save, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Store, ShiftPreset } from "@shared/schema";

// ─── Time helpers ─────────────────────────────────────────────────────────────
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

function calcHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff / 60 : 0;
}

// ─── TimeSelect component ─────────────────────────────────────────────────────
function TimeSelect({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <Select value={snapTo30(value)} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-52">
        {TIME_SLOTS.map((t) => (
          <SelectItem key={t} value={t} className="text-sm font-mono">
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Preset row ───────────────────────────────────────────────────────────────
interface PresetRowProps {
  label: string;
  labelKo: string;
  startKey: keyof PresetForm;
  endKey: keyof PresetForm;
  form: PresetForm;
  onChange: (key: keyof PresetForm, val: string) => void;
  storeId: string;
}

function PresetRow({ label, labelKo, startKey, endKey, form, onChange, storeId }: PresetRowProps) {
  const hours = calcHours(form[startKey] as string, form[endKey] as string);
  return (
    <div className="grid grid-cols-[140px_1fr_1fr_60px] gap-3 items-center">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{labelKo}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Start</p>
        <TimeSelect
          value={form[startKey] as string}
          onChange={(v) => onChange(startKey, v)}
          testId={`input-${storeId}-${startKey}`}
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">End</p>
        <TimeSelect
          value={form[endKey] as string}
          onChange={(v) => onChange(endKey, v)}
          testId={`input-${storeId}-${endKey}`}
        />
      </div>
      <div className="text-right">
        <p className="text-xs text-muted-foreground mb-1">&nbsp;</p>
        <p
          className={`text-sm font-mono font-medium ${hours > 0 ? "text-foreground" : "text-destructive"}`}
          data-testid={`text-hours-${storeId}-${startKey}`}
        >
          {hours > 0 ? `${hours.toFixed(1)}h` : "—"}
        </p>
      </div>
    </div>
  );
}

// ─── Preset form state type ───────────────────────────────────────────────────
interface PresetForm {
  fullDayStart:    string;
  fullDayEnd:      string;
  openShiftStart:  string;
  openShiftEnd:    string;
  closeShiftStart: string;
  closeShiftEnd:   string;
}

const DEFAULT_FORM: PresetForm = {
  fullDayStart:    "06:30",
  fullDayEnd:      "18:30",
  openShiftStart:  "06:30",
  openShiftEnd:    "12:30",
  closeShiftStart: "12:30",
  closeShiftEnd:   "18:30",
};

function presetToForm(preset: ShiftPreset): PresetForm {
  return {
    fullDayStart:    preset.fullDayStart,
    fullDayEnd:      preset.fullDayEnd,
    openShiftStart:  preset.openShiftStart,
    openShiftEnd:    preset.openShiftEnd,
    closeShiftStart: preset.closeShiftStart,
    closeShiftEnd:   preset.closeShiftEnd,
  };
}

// ─── Per-store preset card ────────────────────────────────────────────────────
function StorePresetCard({
  store,
  preset,
}: {
  store: Store;
  preset: ShiftPreset | undefined;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<PresetForm>(preset ? presetToForm(preset) : DEFAULT_FORM);

  useEffect(() => {
    setForm(preset ? presetToForm(preset) : DEFAULT_FORM);
  }, [preset]);

  const handleChange = (key: keyof PresetForm, val: string) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/shift-presets/${store.id}`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-presets"] });
      toast({ title: "Saved", description: `Shift presets updated for ${store.name}.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save presets.", variant: "destructive" });
    },
  });

  const isDirty = JSON.stringify(form) !== JSON.stringify(preset ? presetToForm(preset) : DEFAULT_FORM);

  return (
    <Card data-testid={`card-store-preset-${store.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
        <div>
          <CardTitle className="text-base">{store.name}</CardTitle>
          <CardDescription className="text-xs">
            로스터 셀 편집기에서 사용되는 퀵필 버튼 시간 설정
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !isDirty}
          data-testid={`button-save-preset-${store.id}`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1.5" />
          )}
          Save
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <PresetRow
          label="Full Day"
          labelKo="풀 데이 (전체 시간)"
          startKey="fullDayStart"
          endKey="fullDayEnd"
          form={form}
          onChange={handleChange}
          storeId={store.id}
        />
        <div className="border-t" />
        <PresetRow
          label="Open Shift"
          labelKo="오픈 시프트 (오전 근무)"
          startKey="openShiftStart"
          endKey="openShiftEnd"
          form={form}
          onChange={handleChange}
          storeId={store.id}
        />
        <div className="border-t" />
        <PresetRow
          label="Close Shift"
          labelKo="클로즈 시프트 (오후 근무)"
          startKey="closeShiftStart"
          endKey="closeShiftEnd"
          form={form}
          onChange={handleChange}
          storeId={store.id}
        />
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function AdminShiftPresets() {
  const { data: stores, isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores"],
  });

  const { data: presets, isLoading: presetsLoading } = useQuery<ShiftPreset[]>({
    queryKey: ["/api/shift-presets"],
  });

  const isLoading = storesLoading || presetsLoading;

  // Only stores that use roster features (Sushi & Sandwich)
  const rosterStores = (stores ?? []).filter(
    (s) => s.name === "Sushi" || s.name === "Sandwich"
  );

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-md bg-muted">
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Shift Presets</h1>
            <p className="text-sm text-muted-foreground">
              로스터 셀 편집기의 퀵필 버튼에 사용할 시간 사전 설정
            </p>
          </div>
        </div>

        {/* Explanation */}
        <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-4 py-3">
          각 매장의 <strong>Full Day</strong>, <strong>Open Shift</strong>,{" "}
          <strong>Close Shift</strong> 버튼을 클릭했을 때 자동으로 입력될 시작·종료 시간을
          설정합니다. 설정된 시간은 로스터 페이지의 셀 편집 팝오버에 즉시 반영됩니다.
        </p>

        {/* Store cards */}
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-52 w-full rounded-md" />
            <Skeleton className="h-52 w-full rounded-md" />
          </div>
        ) : rosterStores.length === 0 ? (
          <p className="text-sm text-muted-foreground">로스터 매장이 없습니다.</p>
        ) : (
          rosterStores.map((store) => (
            <StorePresetCard
              key={store.id}
              store={store}
              preset={(presets ?? []).find((p) => p.storeId === store.id)}
            />
          ))
        )}
      </div>
    </AdminLayout>
  );
}
