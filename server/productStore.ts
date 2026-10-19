import { sql } from "drizzle-orm";
import { db } from "./db";

// Product catalogue (stage A). invoice_line_items → one card per supplier product
// (supplier_products) and one price-history row per line (product_prices).
// Line items get deleted and re-inserted when an invoice is re-extracted, so an
// invoice's history rows are replaced as a whole rather than matched line by line.

// Not stock: delivery/fuel/card surcharges, rent and levies, accounting schedules.
const FEE_RE = /surcharge|freight|fuel levy|\blevy\b|delivery|service fee|card fee|\brent\b|outgoings|promotion|schedule/i;

export function productKey(sku: string | null | undefined, description: string): string {
  const code = (sku ?? "").trim();
  // letters+digits only: Pearl prints the same salmon with and without spaces
  return code ? `SKU:${code.toUpperCase()}` : `DESC:${description.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/**
 * Invoices whose line items are newer than their history rows (or have none yet).
 * apply=false only counts. Returns what would be / was created.
 */
export async function syncProducts(apply: boolean) {
  const pending = ((await db.execute(sql`
    SELECT i.id, i.supplier_id, s.name AS supplier, i.invoice_date, i.store_id
    FROM supplier_invoices i
    JOIN suppliers s ON s.id = i.supplier_id
    JOIN invoice_line_item_runs r ON r.invoice_id = i.id AND r.status = 'OK'
    WHERE i.status <> 'DELETED'
      AND NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.invoice_id = i.id AND pp.source = 'invoice' AND pp.created_at >= r.created_at)
    ORDER BY i.invoice_date`)) as any).rows as Array<{ id: string; supplier_id: string; supplier: string; invoice_date: string; store_id: string | null }>;

  const existing = new Set(((await db.execute(sql`SELECT supplier_id || '|' || product_key AS k FROM supplier_products`)) as any).rows.map((r: any) => r.k));
  const newKeys = new Set<string>();
  const bySupplier: Record<string, { invoices: number; prices: number; newProducts: number }> = {};
  let prices = 0;

  for (const inv of pending) {
    const lines = ((await db.execute(sql`
      SELECT description, sku, qty, unit, unit_price, line_total FROM invoice_line_items WHERE invoice_id = ${inv.id}`)) as any).rows as any[];
    const b = (bySupplier[inv.supplier] ??= { invoices: 0, prices: 0, newProducts: 0 });
    b.invoices++;
    for (const l of lines) {
      const k = `${inv.supplier_id}|${productKey(l.sku, l.description)}`;
      if (!existing.has(k) && !newKeys.has(k)) { newKeys.add(k); b.newProducts++; }
    }
    b.prices += lines.length; prices += lines.length;
    if (!apply) continue;

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM product_prices WHERE invoice_id = ${inv.id} AND source = 'invoice'`);
      for (const l of lines) {
        const key = productKey(l.sku, l.description);
        const kind = FEE_RE.test(l.description) ? "fee" : "goods";
        // newest invoice wins for description/unit, unless the owner renamed the card
        const [p] = ((await tx.execute(sql`
          INSERT INTO supplier_products (supplier_id, product_key, name, raw_description, sku, unit, kind)
          VALUES (${inv.supplier_id}, ${key}, ${l.description}, ${l.description}, ${l.sku}, ${l.unit}, ${kind})
          ON CONFLICT (supplier_id, product_key) DO UPDATE SET
            raw_description = EXCLUDED.raw_description,
            unit = coalesce(EXCLUDED.unit, supplier_products.unit),
            name = CASE WHEN supplier_products.name_edited THEN supplier_products.name ELSE EXCLUDED.name END,
            updated_at = now()
          RETURNING id`)) as any).rows;
        await tx.execute(sql`
          INSERT INTO product_prices (product_id, price_date, unit_price, qty, unit, line_total, invoice_id, store_id, source)
          VALUES (${p.id}, ${inv.invoice_date}, ${l.unit_price}, ${l.qty}, ${l.unit}, ${l.line_total}, ${inv.id}, ${inv.store_id}, 'invoice')`);
      }
    });
  }
  console.log(`[products] sync apply=${apply} invoices=${pending.length} prices=${prices} newProducts=${newKeys.size}`);
  return { apply, invoices: pending.length, prices, newProducts: newKeys.size, bySupplier };
}

/** After the owner's first reviewed fill (any card exists), keep the catalogue current every 15 min. */
export function startProductSync(): void {
  const tick = async () => {
    try {
      const any = ((await db.execute(sql`SELECT 1 FROM supplier_products LIMIT 1`)) as any).rows;
      if (any.length) await syncProducts(true);
    } catch (err: any) { console.warn("[products] sync failed:", err?.message ?? err); }
  };
  setInterval(() => void tick(), 15 * 60 * 1000).unref();
}

/** Catalogue rows with latest / previous price (previous = the last different unit price). */
export async function listProducts(opts: { supplierId?: string; q?: string; includeHidden?: boolean; includeFees?: boolean }) {
  const where = [sql`TRUE`];
  if (opts.supplierId) where.push(sql`p.supplier_id = ${opts.supplierId}`);
  if (!opts.includeHidden) where.push(sql`NOT p.hidden`);
  if (!opts.includeFees) where.push(sql`p.kind = 'goods'`);
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    where.push(sql`(p.name ILIKE ${like} OR coalesce(p.brand,'') ILIKE ${like} OR coalesce(p.sku,'') ILIKE ${like} OR coalesce(p.raw_description,'') ILIKE ${like})`);
  }
  const rows = ((await db.execute(sql`
    WITH h AS (
      SELECT pp.*, row_number() OVER (PARTITION BY pp.product_id ORDER BY pp.price_date DESC, pp.created_at DESC) rn
      FROM product_prices pp WHERE pp.unit_price IS NOT NULL)
    SELECT p.id, p.supplier_id, s.name AS supplier_name, p.name, p.brand, p.sku, p.unit, p.kind, p.hidden, p.source,
           last.unit_price AS last_price, last.price_date AS last_date, last.unit AS last_unit,
           (SELECT h2.unit_price FROM h h2 WHERE h2.product_id = p.id AND h2.rn > 1 AND abs(h2.unit_price - last.unit_price) > 0.004 ORDER BY h2.rn LIMIT 1) AS prev_price,
           (SELECT count(*)::int FROM product_prices x WHERE x.product_id = p.id) AS buy_count,
           (SELECT round(avg(x.qty)::numeric, 2) FROM product_prices x WHERE x.product_id = p.id AND x.qty IS NOT NULL) AS avg_qty
    FROM supplier_products p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN h last ON last.product_id = p.id AND last.rn = 1
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY s.name, p.name`)) as any).rows;
  return rows.map((r: any) => ({
    id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name, name: r.name, brand: r.brand, sku: r.sku,
    unit: r.last_unit ?? r.unit, kind: r.kind, hidden: r.hidden, source: r.source,
    lastPrice: r.last_price == null ? null : Number(r.last_price), lastDate: r.last_date,
    prevPrice: r.prev_price == null ? null : Number(r.prev_price),
    buyCount: r.buy_count, avgQty: r.avg_qty == null ? null : Number(r.avg_qty),
  }));
}

export async function productHistory(productId: string) {
  return ((await db.execute(sql`
    SELECT pp.id, pp.price_date, pp.unit_price, pp.qty, pp.unit, pp.line_total, pp.source, pp.note,
           i.invoice_number, i.id AS invoice_id, st.name AS store
    FROM product_prices pp
    LEFT JOIN supplier_invoices i ON i.id = pp.invoice_id
    LEFT JOIN stores st ON st.id = pp.store_id
    WHERE pp.product_id = ${productId}
    ORDER BY pp.price_date, pp.created_at`)) as any).rows.map((r: any) => ({
      id: r.id, date: r.price_date, unitPrice: r.unit_price == null ? null : Number(r.unit_price),
      qty: r.qty == null ? null : Number(r.qty), unit: r.unit, lineTotal: r.line_total == null ? null : Number(r.line_total),
      source: r.source, note: r.note, invoiceNumber: r.invoice_number, invoiceId: r.invoice_id, store: r.store,
    }));
}

export async function createManualProduct(input: { supplierId: string; name: string; unit?: string | null; brand?: string | null; price?: number | null; priceDate?: string | null; note?: string | null }) {
  const key = `MANUAL:${input.name.toUpperCase().replace(/[^A-Z0-9가-힣]/g, "")}`;
  const [p] = ((await db.execute(sql`
    INSERT INTO supplier_products (supplier_id, product_key, name, name_edited, unit, brand, source)
    VALUES (${input.supplierId}, ${key}, ${input.name}, true, ${input.unit ?? null}, ${input.brand ?? null}, 'manual')
    ON CONFLICT (supplier_id, product_key) DO NOTHING RETURNING id`)) as any).rows;
  if (!p) throw new Error("A product with this name already exists for this supplier");
  if (input.price != null) await addManualPrice(p.id, { price: input.price, date: input.priceDate, unit: input.unit, note: input.note });
  return p.id as string;
}

export async function addManualPrice(productId: string, input: { price: number; date?: string | null; qty?: number | null; unit?: string | null; note?: string | null }) {
  const date = input.date || new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  await db.execute(sql`
    INSERT INTO product_prices (product_id, price_date, unit_price, qty, unit, source, note)
    VALUES (${productId}, ${date}, ${input.price}, ${input.qty ?? null}, ${input.unit ?? null}, 'manual', ${input.note ?? null})`);
}

export async function updateProduct(productId: string, patch: { name?: string; brand?: string | null; unit?: string | null; hidden?: boolean; kind?: "goods" | "fee" }) {
  await db.execute(sql`
    UPDATE supplier_products SET
      name = coalesce(${patch.name ?? null}, name),
      name_edited = name_edited OR ${patch.name != null},
      brand = CASE WHEN ${patch.brand !== undefined} THEN ${patch.brand ?? null} ELSE brand END,
      unit = CASE WHEN ${patch.unit !== undefined} THEN ${patch.unit ?? null} ELSE unit END,
      hidden = coalesce(${patch.hidden ?? null}, hidden),
      kind = coalesce(${patch.kind ?? null}, kind),
      updated_at = now()
    WHERE id = ${productId}`);
}
