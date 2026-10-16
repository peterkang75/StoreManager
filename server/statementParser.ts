import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Statements are parsed from `pdftotext -layout` directly (poppler is in the
// Dockerfile), not extractPdfText: pdf-parse splits every cell onto its own
// line, and the rules below were verified against layout text only.
export function pdfToLayoutText(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), "stmt-"));
  try {
    const f = path.join(dir, "s.pdf");
    writeFileSync(f, buf);
    const r = spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type StatementLineType = "INVOICE" | "PAYMENT" | "CREDIT" | "OPENING" | "OTHER";
export interface StatementLine {
  lineType: StatementLineType;
  invoiceNumber: string | null;
  lineDate: string | null;   // YYYY-MM-DD
  dueDate: string | null;
  amount: number;            // invoice amount / payment / credit (positive)
  balance: number | null;    // running balance (activity) or outstanding (outstanding layout)
}
export interface ParsedStatement {
  family: "xero-outstanding" | "xero-activity";
  statementDate: string | null;
  closingBalance: number;
  lines: StatementLine[];
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const DATE_RE = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{2}|\d{4})\b/i;
// Accounting notation: "(9,614.97)" is negative (KTC prints negative balances that way).
const MONEY_RE = /\(?-?[\d,]+\.\d{2}\)?(?![\d])/g;
const money = (s: string) => (/^\(.*\)$/.test(s) ? -1 : 1) * Number(s.replace(/[(),]/g, ""));
const cents = (n: number) => Math.round(n * 100);

function toIso(m: RegExpMatchArray): string {
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${MONTHS[m[2].slice(0, 3).toLowerCase()]}-${m[1].padStart(2, "0")}`;
}

/**
 * Xero "Statement" PDFs (Pearl, Maru, Bakery Connect, KTC). Returns null unless
 * the arithmetic reconciles to the printed BALANCE DUE — never a partial guess.
 */
export function parseXeroStatement(text: string): ParsedStatement | null {
  if (!/Date\s+Activity\s+Reference\s+Due Date\s+Invoice Amount\s+Payments/.test(text)) return null;
  const due = text.match(/BALANCE DUE(?: AUD)?\s+(-?[\d,]+\.\d{2})/);
  if (!due) return null;
  const closingBalance = money(due[1]);
  const activity = /Opening Balance/.test(text);

  const lines: StatementLine[] = [];
  for (const raw of text.split("\n")) {
    const row = raw.trim();
    const d = row.match(DATE_RE);
    if (!d) continue;
    const rest = row.slice(d[0].length).trim();
    const amounts = (rest.match(MONEY_RE) ?? []).map(money);
    const num = rest.match(/#\s*([A-Za-z0-9][A-Za-z0-9\-\/]*)/)?.[1] ?? null;
    const dueM = rest.replace(/#\s*\S+/, "").match(/(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (?:\d{4}|\d{2}))\b/i);
    const lineType: StatementLineType =
      /^Opening Balance/i.test(rest) ? "OPENING"
      : /^Payment/i.test(rest) ? "PAYMENT"
      : /^Credit Note/i.test(rest) ? "CREDIT"
      : /^Invoice/i.test(rest) ? "INVOICE" : "OTHER";
    if (amounts.length === 0) continue;
    const dueDate = lineType === "INVOICE" && dueM ? toIso(dueM[1].match(DATE_RE)!) : null;
    if (activity) {
      const balance = amounts[amounts.length - 1];
      const amount = lineType === "OPENING" ? balance : Math.abs(amounts[0]);
      lines.push({ lineType, invoiceNumber: num, lineDate: toIso(d), dueDate, amount, balance });
    } else {
      // outstanding layout: [amount] | [amount, balance] (empty Payments cell, Maru) | [amount, payments, balance] (Pearl)
      const amount = amounts[0];
      lines.push({ lineType, invoiceNumber: num, lineDate: toIso(d), dueDate, amount: Math.abs(amount), balance: amounts[amounts.length - 1] });
    }
  }
  if (lines.length === 0 || lines.some(l => l.lineType === "OTHER")) return null;

  if (activity) {
    let run: number | null = null;
    for (const l of lines) {
      if (l.lineType === "OPENING") { run = cents(l.balance!); continue; }
      if (run === null) return null;
      run += l.lineType === "INVOICE" ? cents(l.amount) : -cents(l.amount);
      if (run !== cents(l.balance!)) return null;
    }
    if (run !== cents(closingBalance)) return null;
  } else {
    const sum = lines.reduce((a, l) => a + (l.lineType === "INVOICE" ? cents(l.balance!) : -cents(l.amount)), 0);
    if (sum !== cents(closingBalance)) return null;
  }

  const sd = text.match(/(?:As At|Statement Date|To Date)[\s\S]{0,120}?(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (?:\d{4}|\d{2}))/i);
  return {
    family: activity ? "xero-activity" : "xero-outstanding",
    statementDate: sd ? toIso(sd[1].match(DATE_RE)!) : null,
    closingBalance,
    lines,
  };
}

/** Supplier by printed ABN — exactly one match among supplier ABNs, else null. */
export function detectSupplierByAbn<T extends { id: string; abn: string | null }>(text: string, suppliers: T[]): T | null {
  // ABNs print in groups ("20 162 684 700") and sometimes run straight into ours
  // on the same line, so join single-space digit groups and test containment.
  const runs = (text.match(/\d+(?: \d+)*/g) ?? []).map(r => r.replace(/ /g, "")).filter(r => r.length >= 8);
  const hits = suppliers.filter(s => {
    const abn = (s.abn ?? "").replace(/\D/g, "");
    return abn.length >= 8 && runs.some(r => r.includes(abn));
  });
  return hits.length === 1 ? hits[0] : null;
}
