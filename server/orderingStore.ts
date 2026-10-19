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
    SELECT p.id, p.supplier_id, s.name AS supplier_name, p.name, p.unit, p.raw_description, p.pack_qty, p.pack_unit,
           g.name AS group_name, u.term_weekly, u.holiday_weekly,
           (SELECT max(x.price_date)::text FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId}) AS last_date,
           (SELECT x.unit FROM product_prices x WHERE x.product_id = p.id AND x.store_id = ${storeId} ORDER BY x.price_date DESC LIMIT 1) AS last_unit
    FROM supplier_products p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN item_groups g ON g.id = p.group_id
    LEFT JOIN ordering_usage u ON u.product_id = p.id AND u.store_id = ${storeId}
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

  const suppliers = new Map<string, { supplierId: string; supplierName: string; coverWeeks: number; items: any[] }>();
  for (const r of rows) {
    const sup = suppliers.get(r.supplier_id) ?? suppliers.set(r.supplier_id, { supplierId: r.supplier_id, supplierName: r.supplier_name, coverWeeks: cover.get(r.supplier_id) ?? 1, items: [] }).get(r.supplier_id)!;
    const unit = r.last_unit ?? r.unit;
    const h = hint(r.id);
    sup.items.push({
      productId: r.id, name: r.name, unit, groupName: r.group_name, lastDate: r.last_date,
      pack: r.pack_qty > 0 && r.pack_unit ? { qty: Number(r.pack_qty), unit: r.pack_unit } : parsePack(r.raw_description ?? r.name, unit),
      termWeekly: r.term_weekly == null ? null : Number(r.term_weekly),
      holidayWeekly: r.holiday_weekly == null ? null : Number(r.holiday_weekly),
      hintTerm: h.TERM, hintHoliday: h.HOLIDAY,
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
