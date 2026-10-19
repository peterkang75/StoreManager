import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { classifyWeekSeason, type Season } from "@shared/rosterCaps";
import { parsePack } from "@shared/packSize";

// Ordering stage C-1/2: per store, how much of each product is used a week in
// school term and in holidays (in the product's invoice unit: boxes, bottles…),
// and how many weeks one order should cover per supplier. The order screen
// turns that and the stock on hand into a suggested quantity.

const sydneyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function orderingSheet(storeId: string) {
  const holidays = (await storage.getSchoolHolidays()).map(h => ({ startDate: h.startDate, endDate: h.endDate }));
  const thisWeek = monday(sydneyToday());
  const season: Season = classifyWeekSeason(thisWeek, holidays);

  // goods this store has bought, plus any it has usage set for
  const rows: any[] = ((await db.execute(sql`
    SELECT p.id, p.supplier_id, s.name AS supplier_name, s.order_email, p.name, p.unit, p.raw_description, p.pack_qty, p.pack_unit,
           g.name AS group_name, u.term_weekly, u.holiday_weekly,
           st.qty AS stock_qty, st.counted_at::text AS stock_at, coalesce(nullif(ce.nickname, ''), ce.first_name) AS stock_by,
           (SELECT max(x.price_date)::text FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId}) AS last_date,
           (SELECT x.unit FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId} ORDER BY x.price_date DESC LIMIT 1) AS last_unit
    FROM supplier_products p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN item_groups g ON g.id = p.group_id
    LEFT JOIN ordering_usage u ON u.product_id = p.id AND u.store_id = ${storeId}
    LEFT JOIN ordering_stock st ON st.product_id = p.id AND st.store_id = ${storeId}
    LEFT JOIN employees ce ON ce.id = st.counted_by
    WHERE p.kind = 'goods' AND NOT p.hidden
      AND (u.product_id IS NOT NULL OR EXISTS (SELECT 1 FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId}))
    ORDER BY s.name, coalesce(g.name, p.name), p.name`)) as any).rows;

  // hint: average bought per week over the last year, split by term/holiday weeks
  const since = addDays(thisWeek, -52 * 7);
  const buys: any[] = ((await db.execute(sql`
    SELECT product_id, price_date::text AS d, qty FROM product_prices
    WHERE store_id = ${storeId} AND qty IS NOT NULL AND price_date >= ${since}`)) as any).rows;
  const seasonOf = new Map<string, Season>();
  const seasonOfWeek = (w: string) => seasonOf.get(w) ?? seasonOf.set(w, classifyWeekSeason(w, holidays)).get(w)!;
  const byProduct = new Map<string, { first: string; qty: Record<Season, number> }>();
  for (const b of buys) {
    const e = byProduct.get(b.product_id) ?? byProduct.set(b.product_id, { first: b.d, qty: { TERM: 0, HOLIDAY: 0 } }).get(b.product_id)!;
    if (b.d < e.first) e.first = b.d;
    e.qty[seasonOfWeek(monday(b.d))] += Number(b.qty);
  }
  const hint = (productId: string): Record<Season, number | null> => {
    const e = byProduct.get(productId);
    if (!e) return { TERM: null, HOLIDAY: null };
    const weeks: Record<Season, number> = { TERM: 0, HOLIDAY: 0 };
    for (let w = monday(e.first); w < thisWeek; w = addDays(w, 7)) weeks[seasonOfWeek(w)]++; // finished weeks only
    // fewer than 2 weeks of a season says nothing yet
    const avg = (s: Season) => (weeks[s] >= 2 ? Math.round((e.qty[s] / weeks[s]) * 10) / 10 : null);
    return { TERM: avg("TERM"), HOLIDAY: avg("HOLIDAY") };
  };

  const cover = new Map<string, number>(((await db.execute(sql`
    SELECT supplier_id, cover_weeks FROM ordering_supplier_settings WHERE store_id = ${storeId}`)) as any).rows
    .map((r: any) => [r.supplier_id, Number(r.cover_weeks)]));

  const suppliers = new Map<string, { supplierId: string; supplierName: string; orderEmail: string | null; coverWeeks: number; items: any[] }>();
  for (const r of rows) {
    const sup = suppliers.get(r.supplier_id) ?? suppliers.set(r.supplier_id, { supplierId: r.supplier_id, supplierName: r.supplier_name, orderEmail: r.order_email ?? null, coverWeeks: cover.get(r.supplier_id) ?? 1, items: [] }).get(r.supplier_id)!;
    const unit = r.last_unit ?? r.unit;
    const h = hint(r.id);
    sup.items.push({
      productId: r.id, name: r.name, unit, groupName: r.group_name, lastDate: r.last_date,
      pack: r.pack_qty > 0 && r.pack_unit ? { qty: Number(r.pack_qty), unit: r.pack_unit } : parsePack(r.raw_description ?? r.name, unit),
      termWeekly: r.term_weekly == null ? null : Number(r.term_weekly),
      holidayWeekly: r.holiday_weekly == null ? null : Number(r.holiday_weekly),
      hintTerm: h.TERM, hintHoliday: h.HOLIDAY,
      stock: r.stock_qty == null ? null : Number(r.stock_qty), stockAt: r.stock_at, stockBy: r.stock_by,
    });
  }
  return { season, weekStart: thisWeek, suppliers: Array.from(suppliers.values()) };
}

export async function setUsage(storeId: string, productId: string, termWeekly: number | null, holidayWeekly: number | null) {
  if (termWeekly == null && holidayWeekly == null) {
    await db.execute(sql`DELETE FROM ordering_usage WHERE store_id = ${storeId} AND product_id = ${productId}`);
    return;
  }
  await db.execute(sql`
    INSERT INTO ordering_usage (store_id, product_id, term_weekly, holiday_weekly, updated_at)
    VALUES (${storeId}, ${productId}, ${termWeekly}, ${holidayWeekly}, now())
    ON CONFLICT (store_id, product_id) DO UPDATE SET term_weekly = EXCLUDED.term_weekly, holiday_weekly = EXCLUDED.holiday_weekly, updated_at = now()`);
}

export async function setCoverWeeks(storeId: string, supplierId: string, coverWeeks: number) {
  await db.execute(sql`
    INSERT INTO ordering_supplier_settings (store_id, supplier_id, cover_weeks)
    VALUES (${storeId}, ${supplierId}, ${coverWeeks})
    ON CONFLICT (store_id, supplier_id) DO UPDATE SET cover_weeks = EXCLUDED.cover_weeks`);
}

// ── C-3: sending an order by email ─────────────────────────────────────────

export type OrderLineInput = { productId: string; qty: number; stock?: number | null };
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const validEmail = (e: string) => EMAIL_RE.test(e.trim());

export async function setOrderEmail(supplierId: string, email: string | null) {
  await db.execute(sql`UPDATE suppliers SET order_email = ${email} WHERE id = ${supplierId}`);
}

/** The email a supplier would get. Products must belong to that supplier; zero-qty lines are dropped. */
export async function buildOrderEmail(storeId: string, supplierId: string, lines: OrderLineInput[], note: string | null, senderId: string | null) {
  const [store] = ((await db.execute(sql`SELECT name, address, body_aliases FROM stores WHERE id = ${storeId}`)) as any).rows;
  const [sup] = ((await db.execute(sql`SELECT name, order_email FROM suppliers WHERE id = ${supplierId}`)) as any).rows;
  if (!store || !sup) throw new Error("Unknown store or supplier");
  const wanted = lines.filter(l => l.qty > 0);
  if (!wanted.length) throw new Error("Nothing to order");
  const ids = wanted.map(l => l.productId);
  const prods = new Map<string, any>(((await db.execute(sql`
    SELECT p.id, coalesce(p.raw_description, p.name) AS name, p.sku, p.unit, -- the supplier's own wording, not the owner's rename
           (SELECT x.unit FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId} ORDER BY x.price_date DESC LIMIT 1) AS last_unit
    FROM supplier_products p WHERE p.supplier_id = ${supplierId} AND p.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)) as any).rows
    .map((r: any) => [r.id, r]));
  if (prods.size !== new Set(ids).size) throw new Error("A product does not belong to this supplier");
  const [me] = senderId ? ((await db.execute(sql`SELECT first_name AS name FROM employees WHERE id = ${senderId}`)) as any).rows : [];

  const tradingAs = (store.body_aliases ?? [])[0];
  const storeLabel = tradingAs ? `${store.name} (${tradingAs})` : store.name;
  const today = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" }).format(new Date());
  const items = wanted.map(l => {
    const p = prods.get(l.productId);
    return { productId: l.productId, name: p.name as string, sku: (p.sku as string | null) ?? null, unit: (p.last_unit ?? p.unit) as string | null, qty: l.qty, stock: l.stock ?? null };
  });
  const body = [
    `Hi ${sup.name},`,
    ``,
    `Please find our order for ${storeLabel} below.`,
    ...(store.address ? [`Delivery address: ${store.address}`] : []),
    ``,
    ...items.map(i => `- ${i.qty} x ${i.unit ? `${i.unit} ` : ""}${i.name}${i.sku ? ` (code ${i.sku})` : ""}`),
    ...(note?.trim() ? [``, `Notes: ${note.trim()}`] : []),
    ``,
    `Please reply to this email to confirm, or let us know if anything is unavailable.`,
    ``,
    `Thank you,`,
    me?.name ? `${me.name}, ${storeLabel}` : storeLabel,
  ].join("\n");
  return { to: (sup.order_email as string | null) ?? null, subject: `Order - ${storeLabel} - ${today}`, body, items };
}

/**
 * Save the order, then send it. send = null records an order the manager copied
 * into Ordermentum / a text message themselves (channel manual). A failed send is
 * kept (status failed) so nothing is lost and it can be retried.
 */
export async function sendOrder(storeId: string, supplierId: string, lines: OrderLineInput[], note: string | null, senderId: string | null,
  send: ((m: { to: string; subject: string; text: string }) => Promise<void>) | null) {
  const mail = await buildOrderEmail(storeId, supplierId, lines, note, senderId);
  if (send && (!mail.to || !validEmail(mail.to))) throw new Error("This supplier has no order email yet");
  const [o] = ((await db.execute(sql`
    INSERT INTO purchase_orders (store_id, supplier_id, status, channel, to_email, subject, body, note, sent_by, sent_at)
    VALUES (${storeId}, ${supplierId}, ${send ? "sending" : "sent"}, ${send ? "email" : "manual"}, ${send ? mail.to : null}, ${mail.subject}, ${mail.body}, ${note?.trim() || null}, ${senderId}, ${send ? null : sql`now()`})
    RETURNING id`)) as any).rows;
  for (const i of mail.items) await db.execute(sql`
    INSERT INTO purchase_order_lines (order_id, product_id, name, sku, unit, qty, stock)
    VALUES (${o.id}, ${i.productId}, ${i.name}, ${i.sku}, ${i.unit}, ${i.qty}, ${i.stock})`);
  if (!send) return { id: o.id as string, status: "sent" as const };
  try {
    await send({ to: mail.to!, subject: mail.subject, text: mail.body });
    await db.execute(sql`UPDATE purchase_orders SET status = 'sent', sent_at = now() WHERE id = ${o.id}`);
    return { id: o.id as string, status: "sent" as const };
  } catch (e: any) {
    await db.execute(sql`UPDATE purchase_orders SET status = 'failed', error = ${String(e?.message ?? e).slice(0, 500)} WHERE id = ${o.id}`);
    return { id: o.id as string, status: "failed" as const, error: String(e?.message ?? e) };
  }
}

export async function recentOrders(storeId: string, limit = 20) {
  const orders: any[] = ((await db.execute(sql`
    SELECT o.id, o.supplier_id, s.name AS supplier_name, o.status, o.channel, o.to_email, o.subject, o.error, o.sent_at, o.created_at,
           coalesce(nullif(e.nickname, ''), e.first_name) AS sent_by_name,
           (SELECT json_agg(json_build_object('name', l.name, 'unit', l.unit, 'qty', l.qty) ORDER BY l.name) FROM purchase_order_lines l WHERE l.order_id = o.id) AS lines
    FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN employees e ON e.id = o.sent_by
    WHERE o.store_id = ${storeId} ORDER BY o.created_at DESC LIMIT ${limit}`)) as any).rows;
  return orders.map(o => ({ id: o.id, supplierId: o.supplier_id, supplierName: o.supplier_name, status: o.status, channel: o.channel, toEmail: o.to_email,
    subject: o.subject, error: o.error, sentAt: o.sent_at, createdAt: o.created_at, sentByName: o.sent_by_name, lines: o.lines ?? [] }));
}

// ── staff portal: who may do what, and the stock count ─────────────────────

export async function orderingPerms(employeeId: string) {
  const [e] = ((await db.execute(sql`SELECT can_order, can_set_order_usage FROM employees WHERE id = ${employeeId}`)) as any).rows;
  return { canOrder: !!e?.can_order, canSetUsage: !!e?.can_set_order_usage };
}

/** Latest count wins; null clears it. The product must be one this store buys (or has usage for). */
export async function setStock(storeId: string, productId: string, qty: number | null, countedBy: string | null) {
  if (qty == null) { await db.execute(sql`DELETE FROM ordering_stock WHERE store_id = ${storeId} AND product_id = ${productId}`); return { ok: true }; }
  const [ok] = ((await db.execute(sql`SELECT 1 FROM supplier_products p WHERE p.id = ${productId} AND (
      EXISTS (SELECT 1 FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId})
      OR EXISTS (SELECT 1 FROM ordering_usage u WHERE u.product_id = p.id AND u.store_id = ${storeId}))`)) as any).rows;
  if (!ok) throw new Error("This product is not on this store's list");
  await db.execute(sql`
    INSERT INTO ordering_stock (store_id, product_id, qty, counted_by, counted_at) VALUES (${storeId}, ${productId}, ${qty}, ${countedBy}, now())
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = EXCLUDED.qty, counted_by = EXCLUDED.counted_by, counted_at = now()`);
  return { ok: true };
}
