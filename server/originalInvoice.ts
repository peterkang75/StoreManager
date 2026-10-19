import { storage } from "./storage";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { extractPdfText, cleanInvoiceNumber, parseInvoiceWithAI } from "./invoiceParser";
import type { SupplierInvoice } from "@shared/schema";
import { resolveStoreFromAliases } from "./storeAliases";

/**
 * Text-level document check: statements, aged-receivables reports and reminder
 * letters list OTHER invoices and must never stand in as an invoice's original.
 * A "TAX INVOICE" heading near the top wins, because many invoices mention
 * "statement" in their footer.
 */
export function looksLikeStatement(text: string): boolean {
  const u = text.toUpperCase();
  if (/AGED RECEIVABLES/.test(u)) return true;
  if (/TAX INVOICE/.test(u.slice(0, 1500))) return false;
  return /\bSTATEMENT\b/.test(u) || /REMINDER NOTICE|OVERDUE NOTICE|FINAL NOTICE/.test(u);
}

/**
 * When an invoice number already exists, the incoming PDF used to be dropped.
 * That lost every real invoice whose record had been created first from a
 * statement row. Attach the incoming original when the record has no document,
 * or only a statement. Never touches amount/status — a mismatch is noted for review.
 * Returns true when the PDF was attached.
 */
export async function attachOriginalInvoicePdf(
  existing: SupplierInvoice,
  incoming: { pdfBase64: string; text: string; amount?: number | null; source: string },
): Promise<boolean> {
  if (!incoming.pdfBase64 || looksLikeStatement(incoming.text)) return false;
  const raw = (existing.rawExtractedData ?? {}) as Record<string, any>;
  const current: string | undefined = raw.pdfBase64 || undefined;
  if (current === incoming.pdfBase64) return false;
  if (!(await lacksOriginal(existing))) return false;

  let notes = existing.notes ?? "";
  if (incoming.amount != null && Math.abs((existing.amount ?? 0) - incoming.amount) > 0.05) {
    notes += `${notes ? "\n" : ""}Original invoice total ${incoming.amount.toFixed(2)} differs from recorded amount ${(existing.amount ?? 0).toFixed(2)} — please check.`;
  }
  await storage.updateSupplierInvoice(existing.id, {
    notes,
    rawExtractedData: {
      ...raw,
      pdfBase64: incoming.pdfBase64,
      _isStatement: false,
      _originalAttachedAt: new Date().toISOString(),
      _originalSource: incoming.source,
      // keep the statement copy until statements get their own store (PLAN 1-3)
      ...(current ? { _statementPdfBase64: current } : {}),
    },
  });
  console.log(`[originalInvoice] attached original PDF to ${existing.invoiceNumber} (${existing.id}) via ${incoming.source}`);
  return true;
}

/** True when the record holds no document, or only a statement (read-only check). */
export async function lacksOriginal(existing: SupplierInvoice): Promise<boolean> {
  const raw = (existing.rawExtractedData ?? {}) as Record<string, any>;
  if (!raw.pdfBase64) return true;
  if (raw._isStatement === true) return true;
  return looksLikeStatement(await extractPdfText(Buffer.from(raw.pdfBase64, "base64")));
}

/**
 * Matching key for invoice numbers. Text extraction differs by tool — pdf-parse
 * reads Pearl's "INV-72329" as "INV72329" — so exact string equality would
 * re-create already-paid invoices. Compare on letters+digits only.
 */
export function invoiceKey(n: string | null | undefined): string {
  return cleanInvoiceNumber(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const INV_NO = /\b(?:invoice|inv)\s*#?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-\/]*\d)/i;
/** The invoice number from the subject, else from a PDF attachment named like "Invoice KF2455729.pdf". */
export function invoiceNumberFrom(subject: string, attachments: any[] | null | undefined): string | null {
  const fromSubject = subject.match(INV_NO)?.[1];
  if (fromSubject) return fromSubject;
  for (const a of attachments ?? []) {
    const name = String(a?.file_name ?? a?.filename ?? "").replace(/\.pdf$/i, "");
    if (String(a?.content_type ?? "").includes("pdf")) { const m = name.match(INV_NO)?.[1]; if (m) return m; }
  }
  return null;
}

/**
 * Recover invoice originals that were rejected because the sender wasn't
 * whitelisted yet (e.g. Pearl's daniel@ address, May–Oct 2026). Only emails
 * from senders that NOW match a supplier, with an invoice-like subject and a
 * TAX INVOICE PDF; the number must appear in both subject and PDF. Existing
 * record → attach original (amount/status untouched); no record → new PENDING
 * invoice. apply=false is a read-only preview.
 */
export async function recoverRejectedOriginals(
  apply: boolean,
  resolveStore: (opts: { parsedStoreCode?: string | null; supplierId?: string | null; storesCache?: Array<{ id: string; name: string }> }) => Promise<string | null>,
): Promise<{ apply: boolean; rows: any[]; summary: Record<string, { count: number; amount: number }> }> {
  const supplierList = (await storage.getSuppliers()).filter(s => s.active);
  const emails = supplierList.flatMap(s => (s.contactEmails ?? []).map(e => e.trim().toLowerCase())).filter(Boolean);
  if (emails.length === 0) return { apply, rows: [], summary: {} };
  const result = await db.execute(sql`
    SELECT id, sender_email, subject, received_at, raw_payload->'attachments' AS attachments
    FROM rejected_emails
    WHERE lower(sender_email) IN (${sql.join(emails.map(e => sql`${e}`), sql`, `)})
      AND raw_payload::text ILIKE '%application/pdf%'
    ORDER BY received_at DESC`);
  const storesCache = await storage.getStores();
  const ledgerBySupplier = new Map<string, SupplierInvoice[]>();
  const seen = new Set<string>();
  const rows: any[] = [];

  for (const r of (result as any).rows as any[]) {
    const supplier = await storage.findSupplierByEmail(r.sender_email);
    if (!supplier) continue;
    const subject: string = r.subject ?? "";
    const base = { rejectedId: r.id, supplier: supplier.name, subject, receivedAt: r.received_at };
    // "Inv" too: Foodlink's subjects read "FOODLINK Inv SI4631694 Cust No …"
    if (/receipt|statement|remittance|credit/i.test(subject)) { rows.push({ ...base, action: "skip_not_invoice" }); continue; }
    // Pomona's overdue reminders say nothing of an invoice in the subject but attach "Invoice KF2455729.pdf"
    const number = invoiceNumberFrom(subject, r.attachments);
    if (!number) { rows.push({ ...base, action: /\b(?:invoice|inv)\b/i.test(subject) ? "skip_no_number" : "skip_not_invoice" }); continue; }
    const key = `${supplier.id}|${invoiceKey(number)}`;
    if (seen.has(key)) { await (apply ? storage.markRejectedReviewed(r.id, true) : null); rows.push({ ...base, number, action: "duplicate_email" }); continue; }
    seen.add(key);

    const att = ((r.attachments ?? []) as any[]).find(a => String(a?.content_type ?? "").includes("pdf") && typeof a?.content === "string");
    if (!att) { rows.push({ ...base, number, action: "skip_no_pdf" }); continue; }
    const pdfBase64: string = att.content;
    const text = await extractPdfText(Buffer.from(pdfBase64, "base64"));
    if (!/TAX INVOICE/i.test(text.slice(0, 1500)) || looksLikeStatement(text)) { rows.push({ ...base, number, action: "skip_not_tax_invoice" }); continue; }
    const textKeys = new Set((text.match(/[A-Za-z]*[^\sA-Za-z0-9]?\d{3,}/g) ?? []).map(invoiceKey));
    if (!textKeys.has(invoiceKey(number))) { rows.push({ ...base, number, action: "skip_number_not_in_pdf" }); continue; }

    if (!ledgerBySupplier.has(supplier.id)) ledgerBySupplier.set(supplier.id, await storage.getSupplierInvoices({ supplierId: supplier.id }));
    const existing = ledgerBySupplier.get(supplier.id)!.find(e => invoiceKey(e.invoiceNumber) === invoiceKey(number));

    if (existing) {
      const amountInPdf = text.includes(existing.amount.toFixed(2)) || text.includes(existing.amount.toLocaleString("en-AU", { minimumFractionDigits: 2 }));
      if (!(await lacksOriginal(existing))) { rows.push({ ...base, number, action: "skip_has_original", amount: existing.amount, status: existing.status }); continue; }
      if (apply) {
        await attachOriginalInvoicePdf(existing, { pdfBase64, text, source: `rejected-recovery:${r.id}` });
        await storage.markRejectedReviewed(r.id, true);
      }
      rows.push({ ...base, number, action: "attach", amount: existing.amount, status: existing.status, amountInPdf });
      continue;
    }

    // auto-pay suppliers too (Foodlink): the new PENDING row is settled by the autoPay sweep, dated its due date
    const parsed = (await parseInvoiceWithAI(text, supplier.name, subject))?.find(p => invoiceKey(p.invoiceNumber) === invoiceKey(number));
    const amount = parsed?.totalAmount ?? 0;
    if (!parsed || !(amount > 0) || !text.includes(amount.toFixed(2))) { rows.push({ ...base, number, action: "skip_parse_failed", amount: amount || null }); continue; }
    // the store's own names in the PDF (Pomona: "Eatem pty ltd" → Sandwich) beat the AI's guess; a new supplier has no history to fall back on
    const storeId = resolveStoreFromAliases(text, storesCache as any) ?? await resolveStore({ parsedStoreCode: parsed.storeCode, supplierId: supplier.id, storesCache });
    if (apply) {
      await storage.createSupplierInvoice({
        supplierId: supplier.id, storeId, invoiceNumber: number,
        invoiceDate: parsed.issueDate || new Date(r.received_at).toISOString().slice(0, 10),
        dueDate: parsed.dueDate ?? undefined, amount, status: "PENDING",
        rawExtractedData: { pdfBase64, senderEmail: r.sender_email, subject, _isStatement: false, _originalSource: `rejected-recovery:${r.id}` },
        notes: `Recovered from Rejected inbox (sender was not whitelisted when it arrived).\nFrom: ${r.sender_email}\nSubject: ${subject}`,
      });
      await storage.markRejectedReviewed(r.id, true);
    }
    rows.push({ ...base, number, action: "create", amount, issueDate: parsed.issueDate, dueDate: parsed.dueDate, store: storesCache.find(s => s.id === storeId)?.name ?? null });
  }

  const summary: Record<string, { count: number; amount: number }> = {};
  for (const row of rows) {
    const s = (summary[row.action] ??= { count: 0, amount: 0 });
    s.count++; s.amount = Math.round((s.amount + (row.amount ?? 0)) * 100) / 100;
  }
  console.log(`[recover-rejected-originals] apply=${apply}`, JSON.stringify(summary));
  return { apply, rows, summary };
}
