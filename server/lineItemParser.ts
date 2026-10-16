import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// PLAN 1-5: rule-based invoice line items. Reads `pdftotext -raw` (reading
// order: a wrapped description comes out as text lines followed by the numeric
// line), never pdf-parse. A result is returned only when the item amounts add
// up to the total printed on the invoice; the caller also checks that total
// against the ledger amount.
export function pdfToRawText(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), "inv-"));
  try {
    const f = path.join(dir, "i.pdf");
    writeFileSync(f, buf);
    const r = spawnSync("pdftotext", ["-raw", f, "-"], { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ParsedLine {
  description: string;
  sku: string | null;
  qty: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number;
  gstAmount: number | null;
}
export interface ParsedInvoice {
  family: string;
  lines: ParsedLine[];
  itemsTotal: number;  // printed figure the lines must add up to
  docTotal: number;    // printed invoice total (incl. GST) — compared to the ledger by the caller
}

const M = String.raw`-?[\d,]+\.\d{2}`;
const num = (s: string | undefined) => (s == null ? null : Number(s.replace(/[,$]/g, "")));
const cents = (n: number) => Math.round(n * 100);
const grab = (text: string, re: RegExp) => { const m = text.match(re); return m ? num(m[1]) : null; };

interface Family {
  name: string;
  header: RegExp;          // also the section start
  end: RegExp;             // first line after the items
  rowEnd: RegExp;          // a line that closes an item (tested on the single line)
  row: RegExp;             // parses the joined item text; named groups
  itemsTotal: (t: string) => number | null;
  docTotal: (t: string) => number | null;
  gstPerLine?: boolean;    // gst group is an amount, not a rate
  singleLine?: boolean;    // items never wrap: parse the closing line alone (page headers can sit in between)
  skip?: RegExp;           // lines that are never part of an item (barcodes, category headings)
  rowStart?: RegExp;       // a line that begins an item: drop whatever was buffered before it
}

// Campos (Sage) prints its totals as bare figures above their labels.
function camposTotals(t: string): [number, number] | null {
  const ls = t.split("\n").map(l => l.trim());
  const at = ls.findIndex(l => l === "Total Ex GST");
  if (at < 0) return null;
  const nums = ls.slice(0, at).filter(l => /^[\d,]+\.\d{2}$/.test(l)).slice(-3).map(l => Number(l.replace(/,/g, "")));
  return nums.length === 3 ? [nums[0], nums[2]] : null;
}

const FAMILIES: Family[] = [
  {
    // Bakery Connect / Ordermentum
    name: "ordermentum",
    header: /^ITEM QTY PRICE SUBTOTAL$/m,
    end: /^ITEM TOTAL\b/,
    rowEnd: new RegExp(String.raw`\$${M}\s+\$${M}$`),
    row: new RegExp(String.raw`^\*?\s*(?<desc>.+?)\s+(?<qty>-?[\d.]+)\s+\$(?<unitPrice>${M})\s+\$(?<lineTotal>${M})$`),
    itemsTotal: t => grab(t, /^Subtotal \$([\d,]+\.\d{2})$/m),
    docTotal: t => grab(t, /^Total \$([\d,]+\.\d{2})$/m),
  },
  {
    name: "greenstar",
    header: /^PRODUCT QUANTITY DESCRIPTION UNIT UNIT PRICE PRICE$/m,
    end: /Invoice Total/,
    rowEnd: new RegExp(String.raw`\b[A-Za-z]+\s+${M}\s+${M}$`),
    row: new RegExp(String.raw`^(?<sku>\S+)\s+(?<qty>-?[\d.]+)\s+(?<desc>.*?)\s*(?<unit>[A-Za-z]+)\s+(?<unitPrice>${M})\s+(?<lineTotal>${M})$`),
    // Green Star prints prices ex GST and a GST line only when some is charged
    itemsTotal: t => { const tot = grab(t, /Invoice Total \$([\d,]+\.\d{2})/); const gst = grab(t, /^GST\s+\$?([\d,]+\.\d{2})$/m) ?? 0; return tot == null ? null : +(tot - gst).toFixed(2); },
    docTotal: t => grab(t, /Invoice Total \$([\d,]+\.\d{2})/),
  },
  {
    // Xero: Pearl, Maru, KTC, NumberKeepers
    name: "xero",
    header: /^(?:Item )?Description\s+Quantity\s+(?:Unit )?Price\s+(?:GST|Tax)\s+Amount(?: AUD)?$/m,
    end: /^Subtotal\b/,
    rowEnd: new RegExp(String.raw`[\d,]+(?:\.\d+)?\s+[\d,]+\.\d+\s+(?:GST Free|BAS Excluded|Tax Exempt|GST on \w+|\d+(?:\.\d+)?%)\s+${M}$`),
    row: new RegExp(String.raw`^(?<desc>.*?)\s*(?<qty>-?[\d,]+(?:\.\d+)?)\s+(?<unitPrice>-?[\d,]+\.\d+)\s+(?<gst>GST Free|BAS Excluded|Tax Exempt|GST on \w+|\d+(?:\.\d+)?%)\s+(?<lineTotal>${M})$`),
    // Maru sometimes prints the footer straight after the figure ("1,296.75ABN: …")
    itemsTotal: t => grab(t, new RegExp(String.raw`^Subtotal\s+(${M})`, "m")),
    docTotal: t => grab(t, new RegExp(String.raw`^(?:TOTAL AUD|Invoice Total AUD|Total AUD|Total)\s+(${M})$`, "m")),
  },
  // Nippon prints two layouts: "Unit Unit Price, Invoice Qty" and "Unit, Invoice Qty, Unit Price".
  ...(["price-qty", "qty-price"] as const).map((order): Family => ({
    name: `nippon-${order}`,
    header: order === "price-qty" ? /^Code Maker Product Unit Unit$/m : /^Code Maker Product Unit Invoice$/m,
    end: /^Tax Codes:/,
    rowStart: /^[A-Z]{2}\d{5}\s/, // header is split over many short lines; long names wrap the numbers onto the next line
    skip: /^(?:\d{8,14}|DRY|FROZEN|CHILLED|CHILL|FRESH|ALCOHOL|LIQUOR)$/,
    rowEnd: new RegExp(String.raw`\s(?:FREE|GST|GW)\s+${M}\s+[\d.]+\s+\d+$`),
    row: new RegExp(order === "price-qty"
      ? String.raw`^(?<sku>[A-Z]{2}\d{5})\s+(?<desc>.+?)\s+(?<unit>[A-Z]+)\s+(?<unitPrice>${M})\s+(?<qty>-?[\d.]+)\s+(?<lineTotal>${M})\s+(?:FREE|GST|GW)\s+(?<gst>${M})\s+[\d.]+\s+\d+$`
      : String.raw`^(?<sku>[A-Z]{2}\d{5})\s+(?<desc>.+?)\s+(?<unit>[A-Z]+)\s+(?<qty>-?[\d.]+)\s+(?<unitPrice>${M})\s+(?<lineTotal>${M})\s+(?:FREE|GST|GW)\s+(?<gst>${M})\s+[\d.]+\s+\d+$`),
    gstPerLine: true,
    itemsTotal: (t: string) => grab(t, /Sub Total:\s*\$\s*([\d,]+\.\d{2})/),
    docTotal: (t: string) => grab(t, /^Amount:\s*\$\s*([\d,]+\.\d{2})/m),
  })),
  {
    // Campos (Sage): code, description, AMOUNT EX GST, UOM, QTY, tax code, GST, UNIT PRICE —
    // not the printed header order (verified: 24 x 10.19 = 244.56)
    name: "campos",
    header: /^ITEM NO\. QUANTITY UNIT PRICE DESCRIPTION UOM AMOUNT EX GST$/m,
    end: /^Total Ex GST$/,
    singleLine: true,
    rowEnd: new RegExp(String.raw`\bAUG[A-Z]{1,3}\s+${M}\s+${M}`),
    row: new RegExp(String.raw`^(?<sku>\d{6,8})\s+(?<desc>.+?)\s+(?<lineTotal>${M})\s+(?<unit>[A-Za-z0-9]{2,4})\s+(?<qty>-?[\d.]+)\s+AUG[A-Z]{1,3}\s+(?<gst>${M})\s+(?<unitPrice>${M})`),
    gstPerLine: true,
    itemsTotal: t => camposTotals(t)?.[0] ?? null,
    docTotal: t => camposTotals(t)?.[1] ?? null,
  },
  {
    name: "riverina",
    header: /^Item Code Item Description Shipped UOM Item Price GST Line Total$/m,
    end: /^Payment Options/,
    rowEnd: new RegExp(String.raw`\s[A-Z]+\s+${M}\s+${M}\s+${M}$`),
    row: new RegExp(String.raw`^(?<sku>\S+)\s+(?<desc>.+?)\s+(?<qty>-?[\d.]+)\s+(?<unit>[A-Z]+)\s+(?<unitPrice>${M})\s+(?<gst>${M})\s+(?<lineTotal>${M})$`),
    gstPerLine: true,
    itemsTotal: t => grab(t, /Total Ex\s+([\d,]+\.\d{2})/),
    docTotal: t => grab(t, /^Total\s+([\d,]+\.\d{2})$/m),
  },
];

export type ParseFailure = "no_rule" | "no_lines" | "unparsed_row" | "no_totals" | "items_mismatch";

export function parseInvoiceLines(text: string): { ok: true; result: ParsedInvoice } | { ok: false; reason: ParseFailure; family?: string; detail?: string } {
  const fam = FAMILIES.find(f => f.header.test(text));
  if (!fam) return { ok: false, reason: "no_rule" };
  // a form feed (page break) can sit mid-line, gluing the last row to the next page header
  const all = text.split(/[\n\f]/).map(l => l.replace(/\s+/g, " ").trim());
  const start = all.findIndex(l => fam.header.test(l));
  const lines: ParsedLine[] = [];
  let buf: string[] = [];
  for (const l of all.slice(start + 1)) {
    if (fam.end.test(l)) break;
    if (!l || fam.skip?.test(l)) continue;
    if (fam.rowStart?.test(l)) buf = [];
    buf.push(l);
    if (!fam.rowEnd.test(l)) continue;
    const joined = fam.singleLine ? l : buf.join(" ");
    buf = [];
    const g = joined.match(fam.row)?.groups;
    if (!g) return { ok: false, reason: "unparsed_row", family: fam.name, detail: joined.slice(0, 200) };
    let desc = (g.desc ?? "").trim();
    let sku = g.sku ?? null;
    desc = desc.replace(/\s*\(Delivery\s*Comment:[^)]*\)/i, "").trim(); // Pearl appends delivery notes to the name
    const code = desc.match(/^([A-Z]{2}\d{5}),\s*/); // Maru prints "AB50220," before the name
    if (!sku && code) { sku = code[1]; desc = desc.slice(code[0].length); }
    lines.push({
      description: desc, sku, qty: num(g.qty), unit: g.unit ?? null, unitPrice: num(g.unitPrice),
      lineTotal: num(g.lineTotal)!, gstAmount: fam.gstPerLine ? num(g.gst) : null,
    });
  }
  if (lines.length === 0) return { ok: false, reason: "no_lines", family: fam.name };
  const itemsTotal = fam.itemsTotal(text);
  const docTotal = fam.docTotal(text);
  if (itemsTotal == null || docTotal == null) return { ok: false, reason: "no_totals", family: fam.name };
  const sum = lines.reduce((a, l) => a + cents(l.lineTotal), 0);
  if (sum !== cents(itemsTotal)) return { ok: false, reason: "items_mismatch", family: fam.name };
  return { ok: true, result: { family: fam.name, lines, itemsTotal, docTotal } };
}
