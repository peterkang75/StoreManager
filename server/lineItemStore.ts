import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { invoiceLineItems, invoiceLineItemRuns, type Supplier } from "@shared/schema";
import { pdfToRawText, parseInvoiceLines, type ParsedLine } from "./lineItemParser";
import { detectSupplierByAbn } from "./statementParser";

// Bump when rules change so earlier NO_RULE / failed invoices are looked at again.
export const PARSER_VERSION = 5; // 2: Campos header on poppler 22.12, failure detail; 3: Campos rows wrapped over lines; 4: Foodlink; 5: Escalate

export type RunStatus = "OK" | "NO_RULE" | "UNPARSED" | "ITEMS_MISMATCH" | "LEDGER_MISMATCH" | "ABN_OTHER_SUPPLIER" | "ABN_MISSING" | "NO_TEXT";
export interface RunOutcome { invoiceId: string; supplierName: string; status: RunStatus; family: string | null; lines: number; amount: number }

const FAILURE: Record<string, RunStatus> = { no_rule: "NO_RULE", no_lines: "UNPARSED", unparsed_row: "UNPARSED", no_totals: "UNPARSED", items_mismatch: "ITEMS_MISMATCH" };

/**
 * Three gates, all required before a single line is written:
 *  1. item amounts add up to the figure printed on the invoice (in the parser)
 *  2. the printed invoice total matches the ledger amount (±5c)
 *  3. the printed ABN belongs to the record's supplier — misfiled PDFs exist
 * A failed run never deletes items written earlier.
 */
export async function extractLineItems(
  inv: { id: string; supplierId: string | null; amount: number; pdfBase64: string },
  suppliers: Supplier[],
  apply: boolean,
): Promise<RunOutcome> {
  const supplier = suppliers.find(s => s.id === inv.supplierId);
  const pdfMd5 = createHash("md5").update(inv.pdfBase64).digest("hex"); // = SQL md5(text), used to spot a replaced PDF
  const base = { invoiceId: inv.id, supplierName: supplier?.name ?? "(no supplier)", amount: inv.amount };
  const text = pdfToRawText(Buffer.from(inv.pdfBase64, "base64"));

  let status: RunStatus; let family: string | null = null; let lines: ParsedLine[] = []; let detail: string | null = null;
  const p = text.trim() ? parseInvoiceLines(text) : null;
  if (!p) status = "NO_TEXT";
  else if (!p.ok) { status = FAILURE[p.reason]; family = p.family ?? null; detail = p.detail ?? null; }
  else {
    family = p.result.family;
    const abnSupplier = detectSupplierByAbn(text, suppliers);
    if (Math.abs(p.result.docTotal - inv.amount) > 0.05) { status = "LEDGER_MISMATCH"; detail = `printed=${p.result.docTotal} ledger=${inv.amount}`; }
    else if (abnSupplier && abnSupplier.id !== inv.supplierId) { status = "ABN_OTHER_SUPPLIER"; detail = `printed ABN is ${abnSupplier.name}`; }
    else if (!abnSupplier && supplier?.abn) status = "ABN_MISSING";
    else { status = "OK"; lines = p.result.lines; }
  }

  if (apply) {
    await db.transaction(async (tx) => {
      if (status === "OK") {
        await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, inv.id));
        await tx.insert(invoiceLineItems).values(lines.map(l => ({
          invoiceId: inv.id, description: l.description, sku: l.sku, qty: l.qty, unit: l.unit,
          unitPrice: l.unitPrice, lineTotal: l.lineTotal, gstAmount: l.gstAmount,
        })));
      }
      const row = { pdfMd5, status, family, lineCount: lines.length, parserVersion: PARSER_VERSION, detail, createdAt: new Date() };
      await tx.insert(invoiceLineItemRuns).values({ invoiceId: inv.id, ...row })
        .onConflictDoUpdate({ target: invoiceLineItemRuns.invoiceId, set: row });
    });
  }
  return { ...base, status, family, lines: lines.length };
}

/**
 * Every live invoice whose PDF is not a kept statement and that has no run yet,
 * whose PDF changed since its run, or whose earlier failure predates the
 * current rules. One PDF fetched at a time.
 */
export async function sweepLineItems(apply: boolean) {
  const res = await db.execute(sql`
    SELECT i.id FROM supplier_invoices i
    LEFT JOIN invoice_line_item_runs r ON r.invoice_id = i.id
    WHERE i.status <> 'DELETED'
      AND length(i.raw_extracted_data->>'pdfBase64') > 100
      AND md5(i.raw_extracted_data->>'pdfBase64') NOT IN (SELECT md5(pdf_base64) FROM supplier_statements WHERE parse_status <> 'GOVERNMENT')
      AND (r.invoice_id IS NULL
           OR r.pdf_md5 <> md5(i.raw_extracted_data->>'pdfBase64')
           OR (r.status <> 'OK' AND r.parser_version < ${PARSER_VERSION}))`);
  const suppliers = await storage.getSuppliers();
  const bySupplier: Record<string, { invoices: number; ok: number; lines: number; failed: Record<string, number> }> = {};
  const byStatus: Record<string, number> = {};
  for (const { id } of (res as any).rows as Array<{ id: string }>) {
    const one = await db.execute(sql`SELECT supplier_id, amount, raw_extracted_data->>'pdfBase64' AS b64 FROM supplier_invoices WHERE id = ${id}`);
    const r = (one as any).rows[0];
    if (!r?.b64) continue;
    const o = await extractLineItems({ id, supplierId: r.supplier_id, amount: Number(r.amount), pdfBase64: r.b64 }, suppliers, apply);
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const s = (bySupplier[o.supplierName] ??= { invoices: 0, ok: 0, lines: 0, failed: {} });
    s.invoices++;
    if (o.status === "OK") { s.ok++; s.lines += o.lines; } else s.failed[o.status] = (s.failed[o.status] ?? 0) + 1;
  }
  console.log(`[lineItems] sweep apply=${apply}`, JSON.stringify(byStatus));
  return { apply, byStatus, bySupplier };
}

/**
 * New invoices are picked up automatically — but only after the owner has run
 * the reviewed backfill once (a run exists). Until then nothing is written.
 */
export function startLineItemSweep(): void {
  const tick = async () => {
    try {
      const any = await db.execute(sql`SELECT 1 FROM invoice_line_item_runs LIMIT 1`);
      if (((any as any).rows ?? []).length === 0) return;
      await sweepLineItems(true);
    } catch (err: any) {
      console.warn("[lineItems] sweep failed:", err?.message ?? err);
    }
  };
  setInterval(() => void tick(), 15 * 60 * 1000).unref();
}
