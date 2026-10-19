import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Mail, Minus, Plus } from "lucide-react";
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
  stock: number | null; stockAt: string | null; stockBy: string | null;
};
type SupplierBlock = { supplierId: string; supplierName: string; orderEmail: string | null; coverWeeks: number; items: Item[] };
type SentOrder = { id: string; supplierName: string; status: "sent" | "failed" | "sending"; channel: "email" | "manual"; toEmail: string | null; error: string | null;
  sentAt: string | null; createdAt: string; sentByName: string | null; lines: { name: string; unit: string | null; qty: number }[] };
type Sheet = { season: "TERM" | "HOLIDAY"; weekStart: string; suppliers: SupplierBlock[]; perms: { canOrder: boolean; canSetUsage: boolean } };
type Mode = "count" | "order" | "usage";
type Lang = "ko" | "en";

const num = (s: string) => (s.trim() === "" ? null : Number(s));

// Owner's screen is Korean, the staff portal English.
const T = {
  ko: {
    pickStore: "매장 선택", term: "학기 중", holiday: "방학", weekIs: (h: boolean) => `이번 주는 ${h ? "방학" : "학기 중"} — ${h ? "방학" : "학기"} 사용량으로 계산합니다`,
    modes: { count: "재고 세기", order: "주문", usage: "주당 사용량" } as Record<Mode, string>,
    loading: "불러오는 중…", empty: "이 매장 인보이스에서 읽은 상품이 없습니다.", noneSet: "아직 주당 사용량을 정한 상품이 없습니다. '주당 사용량'에서 먼저 정하세요.",
    countHelp: "남은 양을 인보이스 단위(박스, 병 등)로 넣으세요. 넣는 즉시 저장됩니다.",
    counted: (when: string, who: string | null) => `${when}${who ? ` · ${who}` : ""} 셈`, notCounted: "아직 안 셈",
    orderHelp: "추천 주문 = 주당 사용량 × 주 분량 − 마지막으로 센 재고.", showAll: "모든 상품 보기",
    usageHelp: "주당 사용량은 인보이스 단위로 넣으세요. 회색 숫자는 지난 1년 동안 이 매장이 산 양의 주 평균(참고용)입니다.",
    toOrder: (n: number) => `주문할 품목 ${n}개`, stock: "재고", suggest: "추천 주문", termWk: "학기 주당", holWk: "방학 주당",
    cover: ["한 번 주문으로", "주 분량"], orderEmail: "주문 메일", noEmail: "주문 메일 없음 (사장님께 요청)", makeOrder: "주문서 만들기",
    savedEmail: "주문 메일 주소를 저장했습니다", saveFail: "저장하지 못했습니다", badNum: "0 이상의 숫자로 넣어 주세요", badCover: "주 분량은 0~12 사이로 넣어 주세요",
    dlgTitle: (s: string) => `${s} 주문서`, dlgHelp: "추천 주문량이 채워져 있습니다. 필요하면 고치세요. 비우거나 0이면 빠집니다.", note: "메모 (선택)",
    to: "받는 곳", subject: "제목", noTo: "주문 메일 주소 없음 — 메일로는 못 보냅니다. 복사해서 Ordermentum이나 문자로 보내세요.",
    fromNote: "회사 메일 계정에서 나가고, 공급처 답장도 그 메일함으로 옵니다.", cancel: "취소", preview: (n: number) => `주문서 미리보기 (${n})`,
    back: "고치기", copy: "복사해서 직접 보내기", send: "메일 보내기", sent: "주문 메일을 보냈습니다", sendFail: "메일을 보내지 못했습니다 — 주문은 기록해 두었습니다",
    copyAsk: "복사했습니다. Ordermentum이나 문자로 이 주문을 넣으시나요?\n'확인'을 누르면 보낸 주문으로 기록해서 나중에 인보이스와 맞춰 봅니다.",
    recorded: "주문을 기록했습니다", copyFail: "복사하지 못했습니다", buildFail: "주문서를 만들지 못했습니다",
    recent: "최근 보낸 주문", st: { email: "메일 보냄", manual: "직접 보냄", failed: "보내기 실패", sending: "보내는 중" },
  },
  en: {
    pickStore: "Store", term: "School term", holiday: "Holidays", weekIs: (h: boolean) => `This week: ${h ? "school holidays" : "school term"}`,
    modes: { count: "Count stock", order: "Order", usage: "Weekly usage" } as Record<Mode, string>,
    loading: "Loading…", empty: "No items for this store yet.", noneSet: "No weekly usage set yet. Set it under 'Weekly usage' first.",
    countHelp: "Enter what's left, in the invoice unit (cartons, bottles…). Saved straight away.",
    counted: (when: string, who: string | null) => `Counted ${when}${who ? ` by ${who}` : ""}`, notCounted: "Not counted yet",
    orderHelp: "Suggested = weekly usage × weeks covered − last stock count.", showAll: "Show all items",
    usageHelp: "Weekly usage in the invoice unit. Grey numbers are this store's average weekly purchase over the last year (a guide only).",
    toOrder: (n: number) => `${n} to order`, stock: "Stock", suggest: "Suggested", termWk: "Term / wk", holWk: "Holidays / wk",
    cover: ["One order covers", "weeks"], orderEmail: "Order email", noEmail: "No order email (ask the owner)", makeOrder: "Create order",
    savedEmail: "Order email saved", saveFail: "Couldn't save", badNum: "Enter a number of 0 or more", badCover: "Weeks must be between 0 and 12",
    dlgTitle: (s: string) => `Order: ${s}`, dlgHelp: "Suggested quantities are filled in — change them if needed. Blank or 0 is left out.", note: "Note (optional)",
    to: "To", subject: "Subject", noTo: "No order email — can't send by email. Copy it into Ordermentum or a text message.",
    fromNote: "Sent from the company mailbox; supplier replies come back there.", cancel: "Cancel", preview: (n: number) => `Preview order (${n})`,
    back: "Edit", copy: "Copy & send myself", send: "Send email", sent: "Order emailed", sendFail: "Email failed — the order is kept",
    copyAsk: "Copied. Are you placing this order in Ordermentum or by text?\nOK records it as sent so it can be checked against the invoice.",
    recorded: "Order recorded", copyFail: "Couldn't copy", buildFail: "Couldn't build the order",
    recent: "Recent orders", st: { email: "Emailed", manual: "Sent manually", failed: "Failed", sending: "Sending" },
  },
};

const ago = (iso: string | null, lang: Lang) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z")).getTime()) / 60000);
  if (m < 60) return lang === "ko" ? `${Math.max(m, 0)}분 전` : `${Math.max(m, 0)} min ago`;
  if (m < 48 * 60) return lang === "ko" ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 60)} h ago`;
  return lang === "ko" ? `${Math.round(m / 1440)}일 전` : `${Math.round(m / 1440)} days ago`;
};

/** Count stock / order / weekly usage for one store. Used by the owner's page and the staff portal. */
export function OrderingPanel({ stores, lang, isAdmin }: { stores: Store[]; lang: Lang; isAdmin: boolean }) {
  const t = T[lang];
  const { toast } = useToast();
  const [storeId, setStoreId] = useState("");
  useEffect(() => { if (!stores.some(s => s.id === storeId) && stores.length) setStoreId(stores[0].id); }, [storeId, stores]);
  const key = `/api/ordering/${storeId}`;
  const { data: sheet, isLoading } = useQuery<Sheet>({ queryKey: [key], enabled: !!storeId });
  const perms = sheet?.perms ?? { canOrder: false, canSetUsage: false };
  const modes: Mode[] = ["count", ...(perms.canOrder ? ["order" as const] : []), ...(perms.canSetUsage ? ["usage" as const] : [])];
  const [mode, setMode] = useState<Mode>("count");
  useEffect(() => { if (!modes.includes(mode)) setMode("count"); }, [modes.join(), mode]);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<SupplierBlock | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({}); // typed but not yet saved
  useEffect(() => setCounts({}), [storeId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [key] });
  const fail = (e: any) => toast({ title: t.saveFail, description: e?.message, variant: "destructive" });
  const saveStock = async (it: Item, v: number | null) => {
    if (v === it.stock) return;
    if (v != null && !(v >= 0)) { toast({ title: t.badNum, variant: "destructive" }); return; }
    try {
      await apiRequest("PUT", `${key}/stock`, { productId: it.productId, qty: v }); await refresh();
      setCounts(c => { if (num(c[it.productId] ?? "") !== v) return c; const n = { ...c }; delete n[it.productId]; return n; }); // a newer tap keeps its value
    } catch (e) { fail(e); }
  };
  // quick taps build on the value on screen, not the last saved one
  const bump = (it: Item, d: number) => {
    const next = Math.max(0, (num(counts[it.productId] ?? "") ?? it.stock ?? 0) + d);
    setCounts(c => ({ ...c, [it.productId]: String(next) }));
    saveStock(it, next);
  };
  const saveUsage = async (it: Item, term: number | null, hol: number | null) => {
    if (term === it.termWeekly && hol === it.holidayWeekly) return;
    if ([term, hol].some(v => v != null && !(v >= 0))) { toast({ title: t.badNum, variant: "destructive" }); return; }
    try { await apiRequest("PUT", `${key}/usage`, { productId: it.productId, termWeekly: term, holidayWeekly: hol }); refresh(); } catch (e) { fail(e); }
  };
  const saveCover = async (b: SupplierBlock, weeks: number | null) => {
    if (weeks === b.coverWeeks) return;
    if (weeks == null || !(weeks > 0 && weeks <= 12)) { toast({ title: t.badCover, variant: "destructive" }); return; }
    try { await apiRequest("PUT", `${key}/cover`, { supplierId: b.supplierId, coverWeeks: weeks }); refresh(); } catch (e) { fail(e); }
  };
  const saveOrderEmail = async (b: SupplierBlock, email: string) => {
    if (email.trim() === (b.orderEmail ?? "")) return;
    try { await apiRequest("PUT", `/api/ordering/supplier/${b.supplierId}/email`, { email: email.trim() }); refresh(); toast({ title: t.savedEmail }); } catch (e) { fail(e); }
  };

  const holiday = sheet?.season === "HOLIDAY";
  const weeklyOf = (i: Item) => (holiday ? i.holidayWeekly : i.termWeekly);
  const blocks = useMemo(() => (sheet?.suppliers ?? [])
    .map(b => ({ ...b, items: mode === "order" && !showAll ? b.items.filter(i => weeklyOf(i) != null) : b.items }))
    .filter(b => b.items.length > 0), [sheet, mode, showAll]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {stores.length > 1 && (
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-[180px]" data-testid="select-ordering-store"><SelectValue placeholder={t.pickStore} /></SelectTrigger>
            <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {sheet && (
          <span className={`rounded px-2 py-1 text-xs font-medium ${holiday ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" : "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"}`}>
            {t.weekIs(holiday)}
          </span>
        )}
      </div>
      {modes.length > 1 && (
        <div className="grid rounded-md border p-0.5" style={{ gridTemplateColumns: `repeat(${modes.length}, 1fr)` }} role="tablist">
          {modes.map(m => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-testid={`tab-ordering-${m}`}
              className={`py-2 text-sm rounded ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t.modes[m]}</button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{mode === "count" ? t.countHelp : mode === "order" ? t.orderHelp : t.usageHelp}</p>
      {mode === "order" && <label className="flex items-center gap-2 text-sm"><Switch checked={showAll} onCheckedChange={setShowAll} />{t.showAll}</label>}

      {isLoading ? <p className="text-sm text-muted-foreground">{t.loading}</p>
        : blocks.length === 0 ? <p className="text-sm text-muted-foreground">{mode === "order" ? t.noneSet : t.empty}</p>
        : blocks.map(b => {
          const lines = b.items.map(it => ({ it, q: suggestQty(weeklyOf(it), b.coverWeeks, it.stock) }));
          return (
            <div key={b.supplierId} className="rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
                <p className="text-sm font-medium">{b.supplierName}
                  {mode === "order" && <span className="text-muted-foreground font-normal"> · {t.toOrder(lines.filter(l => (l.q ?? 0) > 0).length)}</span>}
                </p>
                {mode === "order" && (
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft(b)} data-testid={`button-order-${b.supplierId}`}>
                    <Mail className="h-3.5 w-3.5" />{t.makeOrder}
                  </Button>
                )}
                {mode === "usage" && (
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {isAdmin ? (
                      <label className="flex items-center gap-1.5">{t.orderEmail}
                        <Input key={`${b.supplierId}-${b.orderEmail}`} className="h-7 w-52" type="email" placeholder="orders@supplier.com.au" defaultValue={b.orderEmail ?? ""}
                          onBlur={e => saveOrderEmail(b, e.target.value)} data-testid={`input-order-email-${b.supplierId}`} />
                      </label>
                    ) : <span className="text-muted-foreground">{b.orderEmail ? `${t.orderEmail}: ${b.orderEmail}` : t.noEmail}</span>}
                    <label className="flex items-center gap-1.5">{t.cover[0]}
                      <Input key={`${b.supplierId}-${b.coverWeeks}`} className="h-7 w-14 text-right" inputMode="decimal" defaultValue={String(b.coverWeeks)}
                        onBlur={e => saveCover(b, num(e.target.value))} data-testid={`input-cover-${b.supplierId}`} />{t.cover[1]}
                    </label>
                  </div>
                )}
              </div>
              <div className="divide-y">
                {lines.map(({ it, q }) => (
                  <div key={it.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="leading-snug">{it.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {it.unit || "EA"}{it.pack ? ` · ${formatPack(it.pack)}` : ""}
                        {mode === "count" && ` · ${it.stockAt ? t.counted(ago(it.stockAt, lang), it.stockBy) : t.notCounted}`}
                      </p>
                    </div>
                    {mode === "count" && (
                      <div className="flex items-center gap-1.5">
                        <Button type="button" size="icon" variant="outline" className="h-10 w-10" aria-label="minus"
                          onClick={() => bump(it, -1)}><Minus className="h-4 w-4" /></Button>
                        <Input className="h-10 w-16 text-center text-base" inputMode="decimal" value={counts[it.productId] ?? (it.stock == null ? "" : String(it.stock))}
                          onChange={e => setCounts(c => ({ ...c, [it.productId]: e.target.value }))}
                          onBlur={e => { if (counts[it.productId] !== undefined) saveStock(it, num(e.target.value)); }} data-testid={`input-stock-${it.productId}`} />
                        <Button type="button" size="icon" variant="outline" className="h-10 w-10" aria-label="plus"
                          onClick={() => bump(it, 1)}><Plus className="h-4 w-4" /></Button>
                      </div>
                    )}
                    {mode === "order" && (
                      <div className="flex items-center gap-4 text-right">
                        <div className="text-[11px] text-muted-foreground">{t.stock}<p className="text-sm text-foreground">{it.stock ?? "—"}</p></div>
                        <div className="text-[11px] text-muted-foreground w-20">{t.suggest}
                          <p className={`text-base font-semibold ${q ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-suggest-${it.productId}`}>{q == null ? "—" : q}</p>
                        </div>
                      </div>
                    )}
                    {mode === "usage" && (
                      <div className="flex items-center gap-2">
                        <UsageInput label={t.termWk} value={it.termWeekly} hint={it.hintTerm} active={!holiday} onSave={v => saveUsage(it, v, it.holidayWeekly)} testId={`input-term-${it.productId}`} />
                        <UsageInput label={t.holWk} value={it.holidayWeekly} hint={it.hintHoliday} active={holiday} onSave={v => saveUsage(it, it.termWeekly, v)} testId={`input-holiday-${it.productId}`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      {storeId && perms.canOrder && <RecentOrders storeId={storeId} lang={lang} />}
      {draft && sheet && (
        <OrderDialog storeId={storeId} block={draft} lang={lang}
          initial={Object.fromEntries(draft.items.map(i => { const q = suggestQty(weeklyOf(i), draft.coverWeeks, i.stock); return [i.productId, q ? String(q) : ""]; }))}
          onClose={() => setDraft(null)} />
      )}
    </div>
  );
}

export function AdminOrdering() {
  const { user } = useAuth();
  const { data: stores = [] } = useQuery<Store[]>({ queryKey: ["/api/stores"] });
  const mine = stores.filter(s => s.active && (user?.role === "ADMIN" || (user?.allowedStoreIds ?? []).includes(s.id))).sort((a, b) => a.name.localeCompare(b.name));
  return <AdminLayout title="Ordering"><OrderingPanel stores={mine} lang="ko" isAdmin={user?.role === "ADMIN"} /></AdminLayout>;
}

function UsageInput({ label, value, hint, active, onSave, testId }: {
  label: string; value: number | null; hint: number | null; active: boolean; onSave: (v: number | null) => void; testId: string;
}) {
  return (
    <label className={`flex flex-col text-[11px] ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}
      <Input key={String(value)} className="h-9 w-20 text-right" inputMode="decimal" defaultValue={value == null ? "" : String(value)}
        placeholder={hint == null ? "" : String(hint)} onBlur={e => onSave(num(e.target.value))} data-testid={testId} />
    </label>
  );
}

function OrderDialog({ storeId, block, lang, initial, onClose }: { storeId: string; block: SupplierBlock; lang: Lang; initial: Record<string, string>; onClose: () => void }) {
  const t = T[lang];
  const { toast } = useToast();
  const [qty, setQty] = useState(initial);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ to: string | null; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const payload = () => ({
    supplierId: block.supplierId, note,
    lines: block.items.map(i => ({ productId: i.productId, qty: Number(qty[i.productId] || 0), stock: i.stock })).filter(l => l.qty > 0),
  });
  const bad = block.items.some(i => qty[i.productId] && !(Number(qty[i.productId]) >= 0));
  const count = payload().lines.length;
  const done = () => queryClient.invalidateQueries({ queryKey: [`/api/ordering/${storeId}/orders`] });

  const doPreview = async () => {
    setBusy(true);
    try { setPreview(await (await apiRequest("POST", `/api/ordering/${storeId}/preview`, payload())).json()); }
    catch (e: any) { toast({ title: t.buildFail, description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const doSend = async () => {
    if (!preview?.to) return;
    setBusy(true);
    try {
      const r = await (await apiRequest("POST", `/api/ordering/${storeId}/send`, payload())).json();
      done();
      if (r.status === "sent") { toast({ title: t.sent, description: `${block.supplierName} · ${preview.to}` }); onClose(); }
      else toast({ title: t.sendFail, description: r.error, variant: "destructive" });
    } catch (e: any) { toast({ title: t.sendFail, description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.body); } catch { toast({ title: t.copyFail, variant: "destructive" }); return; }
    if (!window.confirm(t.copyAsk)) return;
    setBusy(true);
    try { await apiRequest("POST", `/api/ordering/${storeId}/record`, payload()); done(); toast({ title: t.recorded }); onClose(); }
    catch (e: any) { toast({ title: t.saveFail, description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t.dlgTitle(block.supplierName)}</DialogTitle></DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t.dlgHelp}</p>
            <div className="divide-y rounded-md border">
              {block.items.map(i => (
                <label key={i.productId} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <span className="min-w-0">{i.name}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Input className="h-9 w-20 text-right" inputMode="decimal" value={qty[i.productId] ?? ""}
                      onChange={e => { setQty(q => ({ ...q, [i.productId]: e.target.value })); setPreview(null); }} data-testid={`input-order-qty-${i.productId}`} />
                    <span className="w-10 text-xs text-muted-foreground">{i.unit || "EA"}</span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <p className="text-xs mb-1">{t.note}</p>
              <Textarea rows={2} value={note} onChange={e => { setNote(e.target.value); setPreview(null); }} placeholder="e.g. Please deliver before 10am Friday" />
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">{t.to}:</span> {preview.to ?? <span className="text-destructive">{t.noTo}</span>}</p>
            <p><span className="text-muted-foreground">{t.subject}:</span> {preview.subject}</p>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs font-sans">{preview.body}</pre>
            <p className="text-[11px] text-muted-foreground">{t.fromNote}</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          {!preview ? (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>{t.cancel}</Button>
              <Button disabled={busy || bad || count === 0} onClick={doPreview} data-testid="button-order-preview">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}{t.preview(count)}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>{t.back}</Button>
              <Button variant="outline" disabled={busy} onClick={copy} data-testid="button-order-copy">{t.copy}</Button>
              <Button disabled={busy || !preview.to} onClick={doSend} data-testid="button-order-send">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}{t.send}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecentOrders({ storeId, lang }: { storeId: string; lang: Lang }) {
  const t = T[lang];
  const { data: orders = [] } = useQuery<SentOrder[]>({ queryKey: [`/api/ordering/${storeId}/orders`] });
  if (!orders.length) return null;
  const when = (d: string | null) => (d ? new Date(d).toLocaleString(lang === "ko" ? "ko-KR" : "en-AU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  return (
    <div className="rounded-md border">
      <p className="px-3 py-2 border-b bg-muted/30 text-sm font-medium">{t.recent}</p>
      <div className="divide-y">
        {orders.map(o => (
          <div key={o.id} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{o.supplierName}</span>
              <span className={`rounded px-1.5 text-[11px] ${o.status === "sent" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"}`}>
                {o.status === "sent" ? t.st[o.channel] : t.st[o.status]}
              </span>
              <span className="text-xs text-muted-foreground">{when(o.sentAt ?? o.createdAt)}{o.sentByName ? ` · ${o.sentByName}` : ""}{o.toEmail ? ` · ${o.toEmail}` : ""}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{o.lines.map(l => `${l.name} ${l.qty}${l.unit ? ` ${l.unit}` : ""}`).join(" · ")}</p>
            {o.error && <p className="text-xs text-destructive mt-0.5">{o.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
