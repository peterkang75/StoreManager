import { storage } from "./storage";
import { extractPdfText, cleanInvoiceNumber } from "./invoiceParser";
import type { SupplierInvoice } from "@shared/schema";

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
  if (current && raw._isStatement !== true) {
    const currentText = await extractPdfText(Buffer.from(current, "base64"));
    if (!looksLikeStatement(currentText)) return false; // already holds a real invoice
  }

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

/**
 * Matching key for invoice numbers. Text extraction differs by tool — pdf-parse
 * reads Pearl's "INV-72329" as "INV72329" — so exact string equality would
 * re-create already-paid invoices. Compare on letters+digits only.
 */
export function invoiceKey(n: string | null | undefined): string {
  return cleanInvoiceNumber(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
