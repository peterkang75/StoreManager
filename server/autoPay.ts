import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { supplierPayments, supplierInvoices } from "@shared/schema";

// Auto-pay (direct debit) suppliers are meant to land as PAID. Only the webhook
// and the manual AP form did that; the 11 other creation paths (statement
// import, review approve, re-parse, triage, …) left them PENDING — Bakery had
// 23 unpaid in Crew that its statements show paid. One settler covers every path.
export interface AutoPayCandidate {
  id: string; supplierId: string; supplierName: string; invoiceNumber: string;
  invoiceDate: string; dueDate: string | null; amount: number; createdAt: string;
}

export async function findAutoPayCandidates(withinHours?: number): Promise<AutoPayCandidate[]> {
  const recent = withinHours ? sql`AND i.created_at > now() - make_interval(hours => ${withinHours})` : sql``;
  const res = await db.execute(sql`
    SELECT i.id, i.supplier_id, s.name, i.invoice_number, i.invoice_date, i.due_date, i.amount, i.created_at
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE s.is_auto_pay AND i.status IN ('PENDING', 'OVERDUE') AND i.amount > 0
      AND coalesce(i.notes, '') !~* 'credit'   -- credit memos are not debits
      AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p.invoice_id = i.id)
      ${recent}
    ORDER BY s.name, i.invoice_date`);
  return ((res as any).rows as any[]).map(r => ({
    id: r.id, supplierId: r.supplier_id, supplierName: r.name, invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date, dueDate: r.due_date, amount: Number(r.amount), createdAt: String(r.created_at),
  }));
}

/**
 * Record the debit and mark PAID. The debit is dated the due date (when the
 * supplier draws it), else the invoice date; the payment row's timestamp — what
 * Paid History groups by — is that day, or now if it is still ahead.
 */
export async function settleAutoPay(cands: AutoPayCandidate[]): Promise<number> {
  let done = 0;
  for (const c of cands) {
    const day = c.dueDate || c.invoiceDate;
    const at = new Date(`${day}T12:00:00+10:00`);
    const ok = await db.transaction(async (tx) => {
      // re-check inside the transaction: someone may have paid it meanwhile
      const still = ((await tx.execute(sql`SELECT 1 FROM supplier_invoices WHERE id = ${c.id} AND status IN ('PENDING','OVERDUE')
        AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p.invoice_id = ${c.id})`)) as any).rows.length > 0;
      if (!still) return false;
      await tx.insert(supplierPayments).values({
        supplierId: c.supplierId, invoiceId: c.id, paymentDate: day, amount: c.amount, method: "AUTO_DEBIT",
        notes: "Direct debit — supplier is on auto-pay (settled by Crew)",
        createdAt: isNaN(at.getTime()) || at > new Date() ? new Date() : at,
      } as any);
      await tx.update(supplierInvoices).set({ status: "PAID", updatedAt: new Date() }).where(eq(supplierInvoices.id, c.id));
      return true;
    });
    if (ok) done++;
  }
  if (done) console.log(`[autoPay] settled ${done} direct-debit invoice(s)`);
  return done;
}

/** New invoices only (last 24 h): past ones are settled by the owner from the To Pay tab. */
export function startAutoPaySweep(): void {
  const tick = async () => {
    try { await settleAutoPay(await findAutoPayCandidates(24)); }
    catch (err: any) { console.warn("[autoPay] sweep failed:", err?.message ?? err); }
  };
  setInterval(() => void tick(), 15 * 60 * 1000).unref();
}
