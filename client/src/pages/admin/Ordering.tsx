import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import type { Store } from "@shared/schema";
import { formatPack, type Pack } from "@shared/packSize";
import { suggestQty } from "@shared/orderQty";

type Item = {
  productId: string; name: string; unit: string | null; groupName: string | null; lastDate: string | null; pack: Pack | null;
  termWeekly: number | null; holidayWeekly: number | null; hintTerm: number | null; hintHoliday: number | null;
};
type SupplierBlock = { supplierId: string; supplierName: string; coverWeeks: number; items: Item[] };
type Sheet = { season: "TERM" | "HOLIDAY"; weekStart: string; suppliers: SupplierBlock[] };

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const unitKo = (u: string | null) => u || "개";

// Order prep (C-1/2): weekly usage per season + stock on hand -> suggested quantity.
// Sending and saving the order come in the next step.
export function AdminOrdering() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });
  const myStores = stores.filter(s => s.active && (user?.role === "ADMIN" || (user?.allowedStoreIds ?? []).includes(s.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const [storeId, setStoreId] = useState("");
  useEffect(() => { if (!storeId && myStores.length) setStoreId(myStores[0].id); }, [storeId, myStores]);
  const { data: sheet, isLoading } = useQuery<Sheet>({ queryKey: [`/api/ordering/${storeId}`], enabled: !!storeId });
  const [onlySet, setOnlySet] = useState(false);
  const [stock, setStock] = useState<Record<string, string>>({}); // not saved yet: the order itself is step 3
  useEffect(() => setStock({}), [storeId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [`/api/ordering/${storeId}`] });
  const saveUsage = async (it: Item, term: number | null, hol: number | null) => {
    if (term === it.termWeekly && hol === it.holidayWeekly) return;
    if ([term, hol].some(v => v != null && !(v >= 0))) { toast({ title: "사용량은 0 이상의 숫자로 넣어 주세요", variant: "destructive" }); return; }
    try { await apiRequest("PUT", `/api/ordering/${storeId}/usage`, { productId: it.productId, termWeekly: term, holidayWeekly: hol }); refresh(); }
    catch (e: any) { toast({ title: "저장하지 못했습니다", description: e?.message, variant: "destructive" }); }
  };
  const saveCover = async (b: SupplierBlock, weeks: number | null) => {
    if (weeks === b.coverWeeks) return;
    if (weeks == null || !(weeks > 0 && weeks <= 12)) { toast({ title: "주문 한 번에 몇 주 분량인지 0~12 사이로 넣어 주세요", variant: "destructive" }); return; }
    try { await apiRequest("PUT", `/api/ordering/${storeId}/cover`, { supplierId: b.supplierId, coverWeeks: weeks }); refresh(); }
    catch (e: any) { toast({ title: "저장하지 못했습니다", description: e?.message, variant: "destructive" }); }
  };

  const holiday = sheet?.season === "HOLIDAY";
  const blocks = useMemo(() => (sheet?.suppliers ?? [])
    .map(b => ({ ...b, items: onlySet ? b.items.filter(i => i.termWeekly != null || i.holidayWeekly != null) : b.items }))
    .filter(b => b.items.length > 0), [sheet, onlySet]);

  return (
    <AdminLayout title="Ordering">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-[200px]" data-testid="select-ordering-store"><SelectValue placeholder="매장 선택" /></SelectTrigger>
            <SelectContent>{myStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          {sheet && (
            <span className={`rounded px-2 py-1 text-xs font-medium ${holiday ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" : "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"}`}>
              이번 주는 {holiday ? "방학" : "학기 중"} — {holiday ? "방학" : "학기"} 사용량으로 계산합니다
            </span>
          )}
          <label className="flex items-center gap-2 text-sm"><Switch checked={onlySet} onCheckedChange={setOnlySet} />사용량 정한 상품만</label>
        </div>
        <p className="text-xs text-muted-foreground">
          주당 사용량은 인보이스에 적힌 단위(박스, 병 등)로 넣으세요. 회색 숫자는 지난 1년 동안 이 매장이 산 양의 주 평균입니다(참고용). 재고를 넣으면 추천 주문량이 나옵니다.
          재고는 아직 저장되지 않습니다 — 주문 보내기·저장은 다음 단계에서 붙습니다.
        </p>

        {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p>
          : blocks.length === 0 ? <p className="text-sm text-muted-foreground">{onlySet ? "아직 사용량을 정한 상품이 없습니다." : "이 매장 인보이스에서 읽은 상품이 없습니다."}</p>
          : blocks.map(b => {
            const lines = b.items.map(it => {
              const weekly = holiday ? it.holidayWeekly : it.termWeekly;
              return { it, q: suggestQty(weekly, b.coverWeeks, num(stock[it.productId] ?? "")) };
            });
            const toOrder = lines.filter(l => (l.q ?? 0) > 0).length;
            return (
              <div key={b.supplierId} className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
                  <p className="text-sm font-medium">{b.supplierName} <span className="text-muted-foreground font-normal">· 주문할 품목 {toOrder}개</span></p>
                  <label className="flex items-center gap-1.5 text-xs">
                    한 번 주문으로
                    <Input key={`${b.supplierId}-${b.coverWeeks}`} className="h-7 w-16 text-right" inputMode="decimal" defaultValue={String(b.coverWeeks)}
                      onBlur={e => saveCover(b, num(e.target.value))} data-testid={`input-cover-${b.supplierId}`} />
                    주 분량
                  </label>
                </div>
                <div className="divide-y">
                  {lines.map(({ it, q }) => (
                    <div key={it.productId} className="grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm">
                      <div className="col-span-2 sm:col-span-1 min-w-0">
                        <p className="truncate">{it.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {unitKo(it.unit)}{it.pack ? ` · ${formatPack(it.pack)}` : ""}{it.groupName ? ` · 묶음: ${it.groupName}` : ""}
                        </p>
                      </div>
                      <UsageInput label="학기 주당" value={it.termWeekly} hint={it.hintTerm} active={!holiday}
                        onSave={v => saveUsage(it, v, it.holidayWeekly)} testId={`input-term-${it.productId}`} />
                      <UsageInput label="방학 주당" value={it.holidayWeekly} hint={it.hintHoliday} active={holiday}
                        onSave={v => saveUsage(it, it.termWeekly, v)} testId={`input-holiday-${it.productId}`} />
                      <label className="flex flex-col text-[11px] text-muted-foreground">재고
                        <Input className="h-8 w-20 text-right" inputMode="decimal" value={stock[it.productId] ?? ""}
                          onChange={e => setStock(s => ({ ...s, [it.productId]: e.target.value }))} data-testid={`input-stock-${it.productId}`} />
                      </label>
                      <div className="flex flex-col text-[11px] text-muted-foreground sm:w-20 sm:text-right">추천 주문
                        <span className={`text-base font-semibold ${q ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-suggest-${it.productId}`}>
                          {q == null ? "—" : `${q} ${unitKo(it.unit)}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </AdminLayout>
  );
}

function UsageInput({ label, value, hint, active, onSave, testId }: {
  label: string; value: number | null; hint: number | null; active: boolean; onSave: (v: number | null) => void; testId: string;
}) {
  return (
    <label className={`flex flex-col text-[11px] ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}
      <Input key={String(value)} className="h-8 w-20 text-right" inputMode="decimal" defaultValue={value == null ? "" : String(value)}
        placeholder={hint == null ? "" : String(hint)} onBlur={e => onSave(num(e.target.value))} data-testid={testId} />
    </label>
  );
}
