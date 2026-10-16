import { sql } from "drizzle-orm";
import { db } from "./db";
import { invoiceKey } from "./originalInvoice";
import { pdfToLayoutText, parseXeroStatement } from "./statementParser";
import { resolveStoreFromAliases } from "./storeAliases";
import { storage } from "./storage";

// PLAN 1-6: statement ↔ ledger cross-check. Read-only — it reports, the owner decides.
// Only itemised (PARSED) statements take part; others need a parser rule first.
export type ReconIssueType =
  | "AMOUNT_DIFF"            // statement and ledger disagree on an invoice's amount
  | "MISSING_IN_LEDGER"      // supplier billed it, we have no record
  | "LEDGER_ONLY"            // we recorded it, the supplier's full activity statement doesn't list it
  | "PAID_BEFORE_STATEMENT"  // we marked it paid before the statement date, the statement still shows it owing
  | "STATEMENT_SHOWS_PAID";  // the statement shows a payment, we still have it unpaid

export interface ReconIssue {
  type: ReconIssueType;
  supplierId: string;
  invoiceNumber: string;
  invoiceId: string | null;
  statementId: string;
  statementDate: string | null;
  statementAmount: number | null;
  ledgerAmount: number | null;
  ledgerStatus: string | null;
  paidOn: string | null;
}
export interface ReconSupplier {
  supplierId: string;
  supplierName: string;
  statements: number;
  latestStatementId: string;
  latestStatementDate: string | null;
  closingBalance: number | null;
  storeName: string | null;    // store the latest statement is for, when the supplier bills more than one
  storeUnknown: boolean;       // multi-store supplier and no store alias matched: per-store checks skipped
  ledgerUnpaidAsOf: number | null; // our unpaid total as at the latest statement date
  invoicesOnStatements: number;
  matched: number;
}

const sydneyDate = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const cents = (n: number) => Math.round(n * 100);

/** Statements stored before the date rule was fixed have no statement_date: re-read them once. */
export async function fillMissingStatementDates(): Promise<void> {
  const res = await db.execute(sql`SELECT id, pdf_base64 FROM supplier_statements WHERE parse_status = 'PARSED' AND statement_date IS NULL`);
  for (const r of (res as any).rows as Array<{ id: string; pdf_base64: string }>) {
    const d = parseXeroStatement(pdfToLayoutText(Buffer.from(r.pdf_base64, "base64")))?.statementDate;
    if (d) await db.execute(sql`UPDATE supplier_statements SET statement_date = ${d} WHERE id = ${r.id} AND statement_date IS NULL`);
  }
}

export async function reconcileStatements(): Promise<{ suppliers: ReconSupplier[]; issues: ReconIssue[] }> {
  const st = ((await db.execute(sql`
    SELECT st.id, st.supplier_id, s.name, st.statement_date, st.closing_balance, st.family, st.received_at
    FROM supplier_statements st JOIN suppliers s ON s.id = st.supplier_id
    WHERE st.parse_status = 'PARSED'`)) as any).rows as Array<{ id: string; supplier_id: string; name: string; statement_date: string | null; closing_balance: number | null; family: string; received_at: string | null }>;
  if (st.length === 0) return { suppliers: [], issues: [] };
  const lines = ((await db.execute(sql`
    SELECT statement_id, line_type, invoice_number, line_date, amount, balance FROM supplier_statement_lines
    WHERE statement_id IN (SELECT id FROM supplier_statements WHERE parse_status = 'PARSED')`)) as any).rows as Array<{ statement_id: string; line_type: string; invoice_number: string | null; line_date: string | null; amount: number; balance: number | null }>;
  const supplierIds = Array.from(new Set(st.map(s => s.supplier_id)));
  const ledger = ((await db.execute(sql`
    SELECT i.id, i.supplier_id, i.store_id, i.invoice_number, i.invoice_date, i.amount, i.status,
           (SELECT max(p.created_at) FROM supplier_payments p WHERE p.invoice_id = i.id) AS paid_at
    FROM supplier_invoices i
    WHERE i.status <> 'DELETED' AND i.supplier_id IN (${sql.join(supplierIds.map(id => sql`${id}`), sql`, `)})`)) as any).rows as Array<{ id: string; supplier_id: string; store_id: string | null; invoice_number: string; invoice_date: string; amount: number; status: string; paid_at: string | null }>;
  const stores = await storage.getStores();

  // effective date: the earlier of printed and received. Xero "As At" can be a future date
  // (Pearl's 13 Oct statement prints 30 Oct), which would make on-time payments look early.
  const stDate = (s: (typeof st)[number]) => {
    const got = s.received_at ? sydneyDate(s.received_at) : null;
    if (!s.statement_date) return got;
    return got && got < s.statement_date ? got : s.statement_date;
  };
  const issues: ReconIssue[] = [];
  const suppliers: ReconSupplier[] = [];

  for (const supplierId of supplierIds) {
    const mine = st.filter(s => s.supplier_id === supplierId).sort((a, b) => (stDate(a) ?? "").localeCompare(stDate(b) ?? ""));
    const latest = mine[mine.length - 1];
    const led = ledger.filter(l => l.supplier_id === supplierId);
    // a supplier can bill two stores on separate statements (KTC: one lease per shop), so
    // ledger-wide checks must be scoped to the statement's store; without a store alias, skip them
    const multiStore = new Set(led.map(l => l.store_id).filter(Boolean)).size > 1;
    const storeOf = new Map<string, string | null>();
    if (multiStore) {
      for (const s of mine) {
        const b64 = ((await db.execute(sql`SELECT pdf_base64 FROM supplier_statements WHERE id = ${s.id}`)) as any).rows[0]?.pdf_base64;
        storeOf.set(s.id, b64 ? resolveStoreFromAliases(pdfToLayoutText(Buffer.from(b64, "base64")), stores as any) : null);
      }
    }
    const scoped = (s: (typeof st)[number]) => (!multiStore ? led : storeOf.get(s.id) ? led.filter(l => l.store_id === storeOf.get(s.id)) : null);
    const ledByKey = new Map(led.map(l => [invoiceKey(l.invoice_number), l]));
    const paidOn = (l: (typeof led)[number]) => (l.paid_at ? sydneyDate(l.paid_at) : null);
    const base = (s: (typeof st)[number], no: string, l?: (typeof led)[number]) => ({
      supplierId, invoiceNumber: no, invoiceId: l?.id ?? null, statementId: s.id, statementDate: stDate(s),
      ledgerAmount: l?.amount ?? null, ledgerStatus: l?.status ?? null, paidOn: l ? paidOn(l) : null,
    });

    // every invoice the supplier listed, latest statement wins
    const listed = new Map<string, { s: (typeof st)[number]; no: string; amount: number }>();
    const paidOnStatement = new Map<string, (typeof st)[number]>();
    for (const s of mine) {
      for (const ln of lines.filter(x => x.statement_id === s.id && x.invoice_number)) {
        const k = invoiceKey(ln.invoice_number);
        if (ln.line_type === "INVOICE") listed.set(k, { s, no: ln.invoice_number!, amount: ln.amount });
        if (ln.line_type === "PAYMENT") paidOnStatement.set(k, s);
      }
    }
    let matched = 0;
    for (const [k, v] of Array.from(listed)) {
      const l = ledByKey.get(k);
      if (!l) issues.push({ type: "MISSING_IN_LEDGER", ...base(v.s, v.no), statementAmount: v.amount });
      else if (Math.abs(l.amount - v.amount) > 0.05) issues.push({ type: "AMOUNT_DIFF", ...base(v.s, v.no, l), statementAmount: v.amount });
      else matched++;
    }

    // activity statements list everything in their period — anything of ours in that window they omit
    for (const s of mine.filter(x => x.family === "xero-activity")) {
      const own = lines.filter(x => x.statement_id === s.id && x.line_date);
      const pool = scoped(s);
      if (own.length === 0 || !pool) continue;
      const from = own.map(x => x.line_date!).sort()[0];
      const to = stDate(s) ?? own.map(x => x.line_date!).sort().slice(-1)[0];
      for (const l of pool.filter(x => x.invoice_date >= from && x.invoice_date <= to)) {
        if (!listed.has(invoiceKey(l.invoice_number))) issues.push({ type: "LEDGER_ONLY", ...base(s, l.invoice_number, l), statementAmount: null });
      }
    }

    // latest outstanding statement: still owing per supplier, but we paid before that date
    if (latest.family === "xero-outstanding" && stDate(latest)) {
      for (const ln of lines.filter(x => x.statement_id === latest.id && x.line_type === "INVOICE" && (x.balance ?? 0) > 0)) {
        const l = ledByKey.get(invoiceKey(ln.invoice_number));
        if (l?.status === "PAID" && paidOn(l) && paidOn(l)! < stDate(latest)!) {
          issues.push({ type: "PAID_BEFORE_STATEMENT", ...base(latest, ln.invoice_number!, l), statementAmount: ln.balance });
        }
      }
    }
    for (const [k, s] of Array.from(paidOnStatement)) {
      const l = ledByKey.get(k);
      if (l && l.status !== "PAID") issues.push({ type: "STATEMENT_SHOWS_PAID", ...base(s, l.invoice_number, l), statementAmount: null });
    }

    // our unpaid total as at the latest statement date
    const asOf = stDate(latest);
    const pool = scoped(latest);
    const unpaid = asOf && pool
      // a PAID invoice with no payment record has an unknown pay date — count it as paid
      ? pool.filter(l => l.invoice_date <= asOf && (l.status !== "PAID" || (paidOn(l) != null && paidOn(l)! > asOf))).reduce((a, l) => a + cents(l.amount), 0) / 100
      : null;
    suppliers.push({
      supplierId, supplierName: latest.name, statements: mine.length, latestStatementId: latest.id,
      latestStatementDate: asOf, closingBalance: latest.closing_balance, ledgerUnpaidAsOf: unpaid,
      storeName: stores.find(x => x.id === storeOf.get(latest.id))?.name ?? null, storeUnknown: multiStore && !storeOf.get(latest.id),
      invoicesOnStatements: listed.size, matched,
    });
  }
  suppliers.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  return { suppliers, issues };
}
