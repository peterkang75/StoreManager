import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Search, TrendingDown, TrendingUp } from "lucide-react";
import type { Supplier } from "@shared/schema";
import { formatPack, type Pack, type PackUnit } from "@shared/packSize";
import { Checkbox } from "@/components/ui/checkbox";

type ProductRow = {
  id: string; supplierId: string; supplierName: string; name: string; brand: string | null; sku: string | null;
  unit: string | null; kind: "goods" | "fee"; hidden: boolean; source: "invoice" | "manual";
  lastPrice: number | null; lastDate: string | null; prevPrice: number | null; buyCount: number; avgQty: number | null;
  groupId: string | null; groupName: string | null; pack: Pack | null; packAuto: boolean; perUnitPrice: number | null;
};
type Group = { id: string; name: string; items: ProductRow[] };
type Suggestion = { word: string; suppliers: number; items: ProductRow[] };

const UNIT_KO: Record<PackUnit, string> = { kg: "kg", L: "L", ea: "개" };
const perUnit = (p: ProductRow) => (p.perUnitPrice == null || !p.pack ? "—" : `${aud(p.perUnitPrice)}/${UNIT_KO[p.pack.unit]}`);
type PriceRow = {
  id: string; date: string; unitPrice: number | null; qty: number | null; unit: string | null; lineTotal: number | null;
  source: "invoice" | "manual"; note: string | null; invoiceNumber: string | null; store: string | null;
};

const aud = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }) : "—");
const pct = (last: number | null, prev: number | null) => (last == null || prev == null || prev === 0 ? null : ((last - prev) / prev) * 100);

function Change({ last, prev }: { last: number | null; prev: number | null }) {
  const p = pct(last, prev);
  if (p == null) return <span className="text-muted-foreground">—</span>;
  const up = p > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}
      title={`이전 단가 ${aud(prev)} → 지금 ${aud(last)}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{up ? "인상" : "인하"} {Math.abs(p).toFixed(1)}%
    </span>
  );
}

export function AdminProducts() {
  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("all");
  const [includeFees, setIncludeFees] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<"list" | "groups">("list");

  const params = new URLSearchParams();
  if (supplierId !== "all") params.set("supplierId", supplierId);
  if (q.trim()) params.set("q", q.trim());
  if (includeFees) params.set("includeFees", "true");
  if (includeHidden) params.set("includeHidden", "true");
  const { data: products = [], isLoading } = useQuery<ProductRow[]>({ queryKey: [`/api/products?${params.toString()}`] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const activeSuppliers = suppliers.filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const filtersOff = !q.trim() && supplierId === "all" && !includeHidden;

  return (
    <AdminLayout title="Products">
      <div className="flex flex-col gap-4">
        <div className="inline-flex rounded-md border p-0.5 self-start" role="tablist">
          {([["list", "상품 목록"], ["groups", "품목 묶음 · 가격 비교"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`px-3 py-1.5 text-sm rounded ${view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`tab-products-${k}`}>{label}</button>
          ))}
        </div>

        {view === "groups" ? <GroupsView onOpen={setOpenId} /> : <>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input className="pl-8" placeholder="상품 검색 (예: 연어, milk, 마요네즈)" value={q} onChange={e => setQ(e.target.value)} data-testid="input-product-search" />
          </div>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="w-[220px]" data-testid="select-product-supplier"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 공급처</SelectItem>
              {activeSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm"><Switch checked={includeFees} onCheckedChange={setIncludeFees} />비용 항목 포함</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={includeHidden} onCheckedChange={setIncludeHidden} />숨긴 상품 포함</label>
          <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)} data-testid="button-product-add"><Plus className="h-4 w-4" />상품 추가</Button>
        </div>

        {!isLoading && products.length === 0 && filtersOff && <FirstFillPanel />}

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-2 px-3">상품</th><th className="py-2 px-3">공급처</th><th className="py-2 px-3">단위</th>
                <th className="py-2 px-3">포장</th>
                <th className="py-2 px-3 text-right">최근 단가</th><th className="py-2 px-3 text-right">단위당</th><th className="py-2 px-3">이전 대비</th>
                <th className="py-2 px-3">최근 구매</th><th className="py-2 px-3 text-right">구매 횟수</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="py-10 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />불러오는 중…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">조건에 맞는 상품이 없습니다.</td></tr>
              ) : products.map(p => (
                <tr key={p.id} className={`border-t cursor-pointer hover:bg-muted/30 ${p.hidden ? "opacity-50" : ""}`} onClick={() => setOpenId(p.id)} data-testid={`row-product-${p.id}`}>
                  <td className="py-2 px-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[p.groupName && `묶음: ${p.groupName}`, p.brand, p.sku && `코드 ${p.sku}`, p.source === "manual" && "직접 등록", p.kind === "fee" && "비용 항목", p.hidden && "숨김"].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="py-2 px-3">{p.supplierName}</td>
                  <td className="py-2 px-3">{p.unit ?? "—"}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{formatPack(p.pack)}{p.packAuto && <span className="ml-1 text-[10px] text-muted-foreground" title="상품명에서 자동으로 읽은 값입니다. 틀리면 상품 창에서 고치세요.">자동</span>}</td>
                  <td className="py-2 px-3 text-right font-mono">{aud(p.lastPrice)}</td>
                  <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{perUnit(p)}</td>
                  <td className="py-2 px-3 text-xs"><Change last={p.lastPrice} prev={p.prevPrice} /></td>
                  <td className="py-2 px-3 whitespace-nowrap">{day(p.lastDate)}</td>
                  <td className="py-2 px-3 text-right">{p.buyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>}
      </div>
      {openId && <ProductDialog id={openId} row={products.find(p => p.id === openId) ?? null} onClose={() => setOpenId(null)} />}
      {adding && <AddProductDialog suppliers={activeSuppliers} onClose={() => setAdding(false)} />}
    </AdminLayout>
  );
}

const invalidateProducts = () => queryClient.invalidateQueries({ predicate: q => /^\/api\/(products|product-groups)/.test(String(q.queryKey[0])) });

// First fill of the catalogue from invoice items: preview, then the owner confirms.
function FirstFillPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ invoices: number; prices: number; newProducts: number; bySupplier: Record<string, { invoices: number; prices: number; newProducts: number }> } | null>(null);
  const run = async (apply: boolean) => (await apiRequest("POST", "/api/products/sync", { apply })).json();
  return (
    <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-center justify-between gap-3">
      <div className="text-xs text-blue-800 dark:text-blue-200">
        <strong>상품 장부가 비어 있습니다.</strong> 지금까지 인보이스에서 읽은 품목으로 상품 카드와 가격 기록을 만듭니다. 숫자를 먼저 보여 드리고, 확인을 누르면 저장합니다. 그다음부터는 자동으로 채워집니다.
      </div>
      <Button size="sm" variant="outline" className="shrink-0" disabled={busy}
        onClick={async () => { setBusy(true); try { setPreview(await run(false)); } catch (e: any) { toast({ title: "미리보기에 실패했습니다", description: e?.message, variant: "destructive" }); } finally { setBusy(false); } }}
        data-testid="button-products-fill-preview">
        {busy && !preview ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}상품 장부 채우기…
      </Button>
      <Dialog open={preview !== null} onOpenChange={o => { if (!o && !busy) setPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>상품 장부 채우기</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-2 text-sm">
              <p>상품 카드 <strong>{preview.newProducts}</strong>개, 가격 기록 <strong>{preview.prices}</strong>줄을 만듭니다(인보이스 {preview.invoices}장).</p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th>공급처</th><th className="text-right">인보이스</th><th className="text-right">상품</th><th className="text-right">가격 기록</th></tr></thead>
                <tbody>{Object.entries(preview.bySupplier).sort((a, b) => b[1].prices - a[1].prices).map(([n, v]) => (
                  <tr key={n}><td>{n}</td><td className="text-right">{v.invoices}</td><td className="text-right">{v.newProducts}</td><td className="text-right">{v.prices}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>취소</Button>
            <Button disabled={busy || !preview?.prices}
              onClick={async () => {
                setBusy(true);
                try { const r = await run(true); invalidateProducts(); toast({ title: "상품 장부를 채웠습니다", description: `상품 ${r.newProducts}개, 가격 기록 ${r.prices}줄` }); setPreview(null); }
                catch (e: any) { toast({ title: "저장에 실패했습니다", description: e?.message, variant: "destructive" }); }
                finally { setBusy(false); }
              }}
              data-testid="button-products-fill-confirm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}채우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const chartConfig = { unitPrice: { label: "단가", color: "hsl(var(--chart-2))" } } satisfies ChartConfig;

function ProductDialog({ id, row, onClose }: { id: string; row: ProductRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: history = [], isLoading } = useQuery<PriceRow[]>({ queryKey: [`/api/products/${id}/prices`] });
  const [name, setName] = useState(row?.name ?? "");
  const [brand, setBrand] = useState(row?.brand ?? "");
  const [unit, setUnit] = useState(row?.unit ?? "");
  const [hidden, setHidden] = useState(row?.hidden ?? false);
  const [fee, setFee] = useState(row?.kind === "fee");
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/product-groups"] });
  const [groupId, setGroupId] = useState<string>(row?.groupId ?? "none");
  const [newGroup, setNewGroup] = useState("");
  // pack: blank = keep the size read from the name; filled = the owner's size
  const [packQty, setPackQty] = useState(row && !row.packAuto && row.pack ? String(row.pack.qty) : "");
  const [packUnit, setPackUnit] = useState<PackUnit>(row?.pack?.unit ?? "ea");
  const [price, setPrice] = useState(""); const [date, setDate] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const points = useMemo(() => history.filter(h => h.unitPrice != null).map(h => ({ date: h.date, unitPrice: h.unitPrice })), [history]);

  const save = async () => {
    setBusy(true);
    try {
      let gid: string | null = groupId === "none" ? null : groupId;
      if (groupId === "new") {
        if (!newGroup.trim()) { toast({ title: "새 묶음 이름을 넣어 주세요", variant: "destructive" }); setBusy(false); return; }
        gid = (await (await apiRequest("POST", "/api/product-groups", { name: newGroup.trim(), productIds: [] })).json()).id;
      }
      const pack = packQty.trim() === "" ? null : { qty: Number(packQty), unit: packUnit };
      if (pack && !(pack.qty > 0)) { toast({ title: "포장 수량을 0보다 큰 숫자로 넣어 주세요", variant: "destructive" }); setBusy(false); return; }
      await apiRequest("PATCH", `/api/products/${id}`, { name, brand, unit, hidden, kind: fee ? "fee" : "goods", groupId: gid, pack });
      invalidateProducts(); toast({ title: "저장했습니다" }); onClose();
    } catch (e: any) { toast({ title: "저장에 실패했습니다", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const addPrice = async () => {
    if (!(Number(price) >= 0) || price === "") { toast({ title: "단가를 숫자로 넣어 주세요", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await apiRequest("POST", `/api/products/${id}/prices`, { price: Number(price), date: date || null, unit: unit || null, note: note || null });
      setPrice(""); setNote(""); invalidateProducts(); toast({ title: "가격을 기록했습니다" });
    } catch (e: any) { toast({ title: "기록에 실패했습니다", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{row?.name ?? "상품"} <span className="text-sm font-normal text-muted-foreground">· {row?.supplierName}</span></DialogTitle></DialogHeader>

        <div className="space-y-1">
          <p className="text-sm font-medium">단가 변화{row?.unit ? ` (${row.unit}당)` : ""}</p>
          {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p>
            : points.length < 2 ? <p className="text-sm text-muted-foreground">가격 기록이 {points.length}건이라 그래프를 그릴 수 없습니다.</p>
            : (
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <LineChart data={points} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={d => new Date(`${d}T00:00:00`).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} />
                  <YAxis tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => day(p?.[0]?.payload?.date)} formatter={v => aud(Number(v))} />} />
                  <Line dataKey="unitPrice" type="monotone" stroke="var(--color-unitPrice)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ChartContainer>
            )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>상품명</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>브랜드</Label><Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="예: Birch & Waite" /></div>
          <div><Label>단위</Label><Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="예: EA, KG, CTN" /></div>
          <div>
            <Label>품목 묶음</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger data-testid="select-product-group"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">묶음 없음</SelectItem>
                {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                <SelectItem value="new">+ 새 묶음 만들기</SelectItem>
              </SelectContent>
            </Select>
            {groupId === "new" && <Input className="mt-1.5" value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="예: 마요네즈" />}
          </div>
          <div>
            <Label>포장 크기 (1{unit || "개"}에 들어 있는 양)</Label>
            <div className="flex gap-2">
              <Input className="w-28" inputMode="decimal" value={packQty} onChange={e => setPackQty(e.target.value)}
                placeholder={row?.packAuto && row.pack ? `자동 ${row.pack.qty}` : "예: 10"} />
              <Select value={packUnit} onValueChange={v => setPackUnit(v as PackUnit)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="L">L</SelectItem><SelectItem value="ea">개</SelectItem></SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {row?.packAuto && row.pack ? `상품명에서 ${formatPack(row.pack)}(으)로 읽었습니다. 틀리면 직접 넣으세요.` : packQty ? "직접 넣은 값입니다. 비우면 상품명에서 읽은 값으로 돌아갑니다." : "상품명에서 크기를 읽지 못했습니다. 단위당 가격을 보려면 넣어 주세요."}
            </p>
          </div>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-2"><Switch checked={hidden} onCheckedChange={setHidden} />숨기기</label>
            <label className="flex items-center gap-2"><Switch checked={fee} onCheckedChange={setFee} />비용 항목(상품 아님)</label>
          </div>
        </div>

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="text-left"><th className="py-1.5 px-3">날짜</th><th className="py-1.5 px-3 text-right">단가</th><th className="py-1.5 px-3 text-right">수량</th><th className="py-1.5 px-3">매장</th><th className="py-1.5 px-3">출처</th></tr>
            </thead>
            <tbody>
              {[...history].reverse().map(h => (
                <tr key={h.id} className="border-t">
                  <td className="py-1.5 px-3 whitespace-nowrap">{day(h.date)}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{aud(h.unitPrice)}</td>
                  <td className="py-1.5 px-3 text-right">{h.qty ?? "—"} {h.unit ?? ""}</td>
                  <td className="py-1.5 px-3">{h.store ?? "—"}</td>
                  <td className="py-1.5 px-3 text-xs text-muted-foreground">{h.source === "manual" ? `직접 입력${h.note ? ` · ${h.note}` : ""}` : `인보이스 ${h.invoiceNumber ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div><Label>단가 직접 기록</Label><Input className="w-28" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="예: 12.50" /></div>
          <div><Label>날짜</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="flex-1 min-w-[160px]"><Label>메모</Label><Input value={note} onChange={e => setNote(e.target.value)} placeholder="예: 전화 견적" /></div>
          <Button variant="outline" disabled={busy} onClick={addPrice}>기록 추가</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>닫기</Button>
          <Button disabled={busy} onClick={save} data-testid="button-product-save">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddProductDialog({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState(""); const [brand, setBrand] = useState(""); const [unit, setUnit] = useState("");
  const [price, setPrice] = useState(""); const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!supplierId || !name.trim()) { toast({ title: "공급처와 상품명을 넣어 주세요", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/products", { supplierId, name, brand, unit, price: price === "" ? null : Number(price), priceDate: date || null });
      invalidateProducts(); toast({ title: "상품을 추가했습니다" }); onClose();
    } catch (e: any) { toast({ title: "추가에 실패했습니다", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>상품 직접 추가</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">인보이스가 오지 않는 공급처(예: Yangzi River, Cn Paultry)의 상품을 등록합니다. 나중에 인보이스가 오면 그 가격도 함께 쌓입니다.</p>
        <div className="space-y-3">
          <div>
            <Label>공급처</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger data-testid="select-add-product-supplier"><SelectValue placeholder="공급처 선택" /></SelectTrigger>
              <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>상품명</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="예: 간장 1.8L" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>브랜드</Label><Input value={brand} onChange={e => setBrand(e.target.value)} /></div>
            <div><Label>단위</Label><Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="예: EA, CTN" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>단가 (선택)</Label><Input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div><Label>날짜</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>취소</Button>
          <Button disabled={busy} onClick={submit} data-testid="button-add-product-confirm">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Item groups: the same item across brands/suppliers, compared per kg / L / each.
function GroupsView({ onOpen }: { onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const { data: groups = [], isLoading } = useQuery<Group[]>({ queryKey: ["/api/product-groups"] });
  const { data: suggestions = [] } = useQuery<Suggestion[]>({ queryKey: ["/api/product-groups/suggestions"] });
  const [pick, setPick] = useState<Suggestion | null>(null);
  const [pickName, setPickName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const createFrom = async () => {
    if (!pickName.trim() || picked.size < 1) { toast({ title: "묶음 이름과 상품을 골라 주세요", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/product-groups", { name: pickName.trim(), productIds: Array.from(picked) });
      invalidateProducts(); toast({ title: "묶음을 만들었습니다", description: `${pickName.trim()} · 상품 ${picked.size}개` }); setPick(null);
    } catch (e: any) { toast({ title: "만들지 못했습니다", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const rename = async (g: Group) => {
    const name = window.prompt("새 묶음 이름", g.name)?.trim();
    if (!name || name === g.name) return;
    try { await apiRequest("PATCH", `/api/product-groups/${g.id}`, { name }); invalidateProducts(); }
    catch (e: any) { toast({ title: "이름을 바꾸지 못했습니다", description: e?.message, variant: "destructive" }); }
  };
  const remove = async (g: Group) => {
    if (!window.confirm(`'${g.name}' 묶음을 지울까요? 상품은 그대로 남고 묶음에서만 빠집니다.`)) return;
    try { await apiRequest("DELETE", `/api/product-groups/${g.id}`); invalidateProducts(); }
    catch (e: any) { toast({ title: "지우지 못했습니다", description: e?.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-950/20 p-3 space-y-2">
          <p className="text-xs text-blue-800 dark:text-blue-200"><strong>추천 묶음</strong> — 같은 단어가 들어간 상품이 여러 공급처에 있습니다. 눌러서 같은 품목끼리 묶으세요.</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 30).map(sg => (
              <Button key={sg.word} size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => { setPick(sg); setPickName(sg.word.charAt(0) + sg.word.slice(1).toLowerCase()); setPicked(new Set(sg.items.map(i => i.id))); }}
                data-testid={`button-suggest-${sg.word}`}>
                {sg.word} <span className="ml-1 text-muted-foreground">공급처 {sg.suppliers} · 상품 {sg.items.length}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p>
        : groups.length === 0 ? <p className="text-sm text-muted-foreground">아직 묶음이 없습니다. 위의 추천 묶음을 누르거나, 상품 창에서 묶음을 정하세요.</p>
        : groups.map(g => {
          const priced = g.items.filter(i => i.perUnitPrice != null);
          const best = priced[0]?.perUnitPrice ?? null;
          const units = new Set(priced.map(i => i.pack?.unit));
          return (
            <div key={g.id} className="rounded-md border">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <p className="text-sm font-medium">{g.name} <span className="text-muted-foreground">({g.items.length})</span></p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => rename(g)}>이름 바꾸기</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => remove(g)}>묶음 지우기</Button>
                </div>
              </div>
              {units.size > 1 && <p className="px-3 pt-2 text-xs text-amber-700 dark:text-amber-300">단위가 섞여 있습니다(kg·L·개). 같은 단위끼리만 비교하세요 — 상품 창에서 포장 크기를 맞추면 됩니다.</p>}
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left"><th className="py-1.5 px-3">상품</th><th className="py-1.5 px-3">공급처</th><th className="py-1.5 px-3">포장</th><th className="py-1.5 px-3 text-right">최근 단가</th><th className="py-1.5 px-3 text-right">단위당</th><th className="py-1.5 px-3">최근 구매</th></tr>
                </thead>
                <tbody>
                  {g.items.map(i => (
                    <tr key={i.id} className="border-t cursor-pointer hover:bg-muted/30" onClick={() => onOpen(i.id)}>
                      <td className="py-1.5 px-3">{i.name}{i.brand ? <span className="text-xs text-muted-foreground"> · {i.brand}</span> : null}</td>
                      <td className="py-1.5 px-3">{i.supplierName}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">{formatPack(i.pack)}{i.packAuto && <span className="ml-1 text-[10px] text-muted-foreground">자동</span>}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{aud(i.lastPrice)}</td>
                      <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">
                        {perUnit(i)}{best != null && i.perUnitPrice === best && units.size === 1 && priced.length > 1 && <span className="ml-1.5 rounded px-1 text-[10px] font-sans bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">가장 쌈</span>}
                      </td>
                      <td className="py-1.5 px-3 whitespace-nowrap">{day(i.lastDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

      <Dialog open={pick !== null} onOpenChange={o => { if (!o && !busy) setPick(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>묶음 만들기</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>묶음 이름</Label><Input value={pickName} onChange={e => setPickName(e.target.value)} /></div>
            <p className="text-xs text-muted-foreground">같은 품목만 남기고 나머지는 체크를 빼세요.</p>
            <div className="space-y-1.5">
              {pick?.items.map(i => (
                <label key={i.id} className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={picked.has(i.id)} onCheckedChange={v => setPicked(prev => { const n = new Set(prev); v ? n.add(i.id) : n.delete(i.id); return n; })} />
                  <span>{i.name} <span className="text-xs text-muted-foreground">· {i.supplierName} · {formatPack(i.pack)} · {perUnit(i)}</span></span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPick(null)}>취소</Button>
            <Button disabled={busy || picked.size === 0} onClick={createFrom} data-testid="button-group-create">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}묶음 만들기 ({picked.size})</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
