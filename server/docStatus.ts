import { sql } from "drizzle-orm";
import { db } from "./db";

// PLAN 1-4: which records hold their own invoice document (5-year retention).
//   ORIGINAL       — PDF attached and it is not a kept statement (ASIC/BAS notices count)
//   STATEMENT_ONLY — only a statement backs it (statement PDF attached, or listed on an itemised statement)
//   NONE           — no document at all
// Computed, never stored: the query hashes every PDF (~2.4 s in production), so it
// runs in the background and the invoice list reads the cached result.
// shortcut: up to REFRESH_MS stale for brand-new invoices (no badge until then); upgrade to a stored column if that matters.
export type DocStatus = "ORIGINAL" | "STATEMENT_ONLY" | "NONE";

const REFRESH_MS = 10 * 60 * 1000;
let cache = new Map<string, DocStatus>();
let running: Promise<void> | null = null;

export function getDocStatus(invoiceId: string): DocStatus | undefined {
  return cache.get(invoiceId);
}

export function refreshDocStatus(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const res = await db.execute(sql`
      WITH st AS (SELECT md5(pdf_base64) h, parse_status FROM supplier_statements),
      lines AS (
        SELECT DISTINCT s.supplier_id, upper(regexp_replace(l.invoice_number, '[^A-Za-z0-9]', '', 'g')) k
        FROM supplier_statement_lines l JOIN supplier_statements s ON s.id = l.statement_id
        WHERE l.line_type = 'INVOICE'),
      inv AS (
        SELECT i.id, i.supplier_id, upper(regexp_replace(i.invoice_number, '[^A-Za-z0-9]', '', 'g')) k,
               CASE WHEN length(i.raw_extracted_data->>'pdfBase64') > 100 THEN md5(i.raw_extracted_data->>'pdfBase64') END h
        FROM supplier_invoices i WHERE i.status <> 'DELETED')
      SELECT inv.id,
        CASE WHEN inv.h IS NOT NULL AND (st.h IS NULL OR st.parse_status = 'GOVERNMENT') THEN 'ORIGINAL'
             WHEN inv.h IS NOT NULL OR lines.k IS NOT NULL THEN 'STATEMENT_ONLY'
             ELSE 'NONE' END AS doc
      FROM inv
      LEFT JOIN st ON st.h = inv.h
      LEFT JOIN lines ON lines.supplier_id = inv.supplier_id AND lines.k = inv.k`);
    cache = new Map(((res as any).rows as Array<{ id: string; doc: DocStatus }>).map(r => [r.id, r.doc]));
  })()
    .catch(err => console.warn("[docStatus] refresh failed:", err?.message ?? err))
    .finally(() => { running = null; });
  return running;
}

export function startDocStatusRefresh(): void {
  void refreshDocStatus();
  setInterval(() => void refreshDocStatus(), REFRESH_MS).unref();
}
