import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { supplierStatements, supplierStatementLines } from "@shared/schema";
import { looksLikeStatement } from "./originalInvoice";
import { pdfToLayoutText, parseXeroStatement, detectSupplierByAbn } from "./statementParser";

export type StatementParseStatus = "PARSED" | "NO_RULE" | "UNASSIGNED" | "GOVERNMENT";
export interface StatementOutcome {
  hash: string;
  existed: boolean;
  parseStatus: StatementParseStatus;
  supplierName: string | null;
  lines: number;
  closingBalance: number | null;
}

// ASIC company statements / BAS forwarded by the accountant are not supplier statements.
const GOVERNMENT_RE = /Australian Securities|\bASIC\b|Australian Taxation Office|Activity Statement/i;

/**
 * Keep one copy of a statement PDF (deduped by content hash). Supplier comes from
 * the printed ABN, never from the record it was attached to — statements have
 * been misfiled (Maru PDFs under Pearl). Lines are stored only when the
 * arithmetic reconciled. apply=false computes the outcome without writing.
 */
export async function storeStatementPdf(
  pdfBase64: string,
  opts: { source: string; receivedAt?: Date | null; text?: string; apply?: boolean },
): Promise<StatementOutcome> {
  const buf = Buffer.from(pdfBase64, "base64");
  const hash = createHash("sha256").update(buf).digest("hex");
  const [existing] = await db.select({ id: supplierStatements.id, parseStatus: supplierStatements.parseStatus })
    .from(supplierStatements).where(eq(supplierStatements.pdfHash, hash));
  if (existing) return { hash, existed: true, parseStatus: existing.parseStatus as StatementParseStatus, supplierName: null, lines: 0, closingBalance: null };

  const text = opts.text ?? pdfToLayoutText(buf);
  const gov = GOVERNMENT_RE.test(text);
  const supplier = gov ? null : detectSupplierByAbn(text, await storage.getSuppliers());
  const parsed = supplier ? parseXeroStatement(text) : null;
  const parseStatus: StatementParseStatus = gov ? "GOVERNMENT" : !supplier ? "UNASSIGNED" : parsed ? "PARSED" : "NO_RULE";
  const outcome: StatementOutcome = { hash, existed: false, parseStatus, supplierName: supplier?.name ?? null, lines: parsed?.lines.length ?? 0, closingBalance: parsed?.closingBalance ?? null };
  if (opts.apply === false) return outcome;

  await db.transaction(async (tx) => {
    const [row] = await tx.insert(supplierStatements).values({
      supplierId: supplier?.id ?? null, pdfHash: hash, pdfBase64,
      statementDate: parsed?.statementDate ?? null, closingBalance: parsed?.closingBalance ?? null,
      family: parsed?.family ?? null, parseStatus, source: opts.source, receivedAt: opts.receivedAt ?? new Date(),
    }).onConflictDoNothing().returning({ id: supplierStatements.id });
    if (!row || !parsed) return; // lost a race with a concurrent insert, or nothing to itemise
    await tx.insert(supplierStatementLines).values(parsed.lines.map(l => ({ statementId: row.id, ...l })));
  });
  return outcome;
}

/** Fire-and-forget hook for inbound statement PDFs — never blocks invoice processing. */
export function keepStatement(pdfBase64: string | null | undefined, source: string): void {
  if (!pdfBase64) return;
  // The AI's isStatement flag alone is not enough — require the text check too.
  const text = pdfToLayoutText(Buffer.from(pdfBase64, "base64"));
  if (!looksLikeStatement(text)) return;
  storeStatementPdf(pdfBase64, { source, text })
    .then(o => { if (!o.existed) console.log(`[statementStore] kept statement (${o.parseStatus}, ${o.supplierName ?? "no supplier"}, ${o.lines} lines) via ${source}`); })
    .catch(err => console.warn(`[statementStore] keep failed via ${source}:`, err?.message ?? err));
}

/**
 * Backfill from supplier_invoices: every _statementPdfBase64 copy, plus every
 * pdfBase64 that reads as a statement. One fetch per distinct PDF.
 */
export async function backfillStatements(apply: boolean) {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (h) id, field, created_at FROM (
      SELECT id, '_statementPdfBase64' AS field, created_at, md5(raw_extracted_data->>'_statementPdfBase64') AS h
        FROM supplier_invoices WHERE length(raw_extracted_data->>'_statementPdfBase64') > 100
      UNION ALL
      SELECT id, 'pdfBase64', created_at, md5(raw_extracted_data->>'pdfBase64')
        FROM supplier_invoices WHERE length(raw_extracted_data->>'pdfBase64') > 100
    ) t ORDER BY h, field DESC, created_at`);
  const bySupplier: Record<string, { statements: number; parsed: number; lines: number }> = {};
  const byStatus: Record<string, number> = {};
  const seenHash = new Set<string>();
  let alreadyStored = 0;

  for (const r of (res as any).rows as Array<{ id: string; field: string; created_at: string }>) {
    const one = await db.execute(sql`SELECT raw_extracted_data->>${r.field} AS b64 FROM supplier_invoices WHERE id = ${r.id}`);
    const b64: string | undefined = (one as any).rows[0]?.b64;
    if (!b64) continue;
    const text = pdfToLayoutText(Buffer.from(b64, "base64"));
    if (r.field === "pdfBase64" && !looksLikeStatement(text)) continue;
    // raw db.execute returns timestamps as strings
    const o = await storeStatementPdf(b64, { source: `backfill:${r.id}`, receivedAt: new Date(r.created_at), text, apply });
    if (seenHash.has(o.hash)) continue; // same bytes, different base64 encoding
    seenHash.add(o.hash);
    if (o.existed) { alreadyStored++; continue; }
    byStatus[o.parseStatus] = (byStatus[o.parseStatus] ?? 0) + 1;
    const k = o.supplierName ?? (o.parseStatus === "GOVERNMENT" ? "(government notice)" : "(supplier ABN not on file)");
    const s = (bySupplier[k] ??= { statements: 0, parsed: 0, lines: 0 });
    s.statements++; if (o.parseStatus === "PARSED") { s.parsed++; s.lines += o.lines; }
  }
  console.log(`[statementStore] backfill apply=${apply}`, JSON.stringify(byStatus));
  return { apply, alreadyStored, byStatus, bySupplier };
}
