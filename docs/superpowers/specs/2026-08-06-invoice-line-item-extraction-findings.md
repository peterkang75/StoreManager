# Invoice Line-Item Extraction — Format Survey Across All Suppliers

Date: 2026-08-06
Status: Findings — no code changed yet

## Why this exists

`invoice_line_items` has **0 rows against 713 invoices**. The AP v2 parser that would
fill it (`server/apDocumentParser.ts`) only runs when `AP_PARSER === "claude"`, and
production has neither `AP_PARSER` nor `ANTHROPIC_API_KEY` set — so it has never run.
Every invoice was processed by the legacy OpenAI path, which extracts no line items.

The original PDFs survive in `supplier_invoices.raw_extracted_data.pdfBase64`, so the
question is whether they can be back-filled, and for which suppliers.

## Method

All 536 stored PDFs were decoded, converted with `pdftotext`, and parsed with a
per-supplier rule. **A rule counts as working only when the extracted line amounts sum
to the control total printed on the document itself** (Subtotal / Total Ex GST /
Invoice Total, whichever that supplier prints). Nothing is accepted on the strength of
"it looked right".

## Headline result

| | |
|---|---|
| PDFs examined | 536 |
| Scanned/image-only (would need OCR) | **0** |
| Real invoices | 341 |
| Statements, remittances, dunning letters | 195 |
| Invoices reconciled to their own control total | **340 / 341 (99.7%)** |
| Line items extracted | **1,634** |
| Distinct format families needed | 8 |

The single failure is not a parsing failure: a Bakery Connect PDF is stored against a
Pearl Seafoods invoice record (see Data-quality findings).

**No supplier is blocked by its document format.** Every format encountered is
rule-parseable without AI. The real constraint is that for four suppliers the invoice
PDFs never arrive at all.

## Format families

| Family | Suppliers | Columns | Notes |
|---|---|---|---|
| **Xero** | Maru Food, Pearl Seafoods, KTC, NumberKeepers | Description, Qty, Unit Price, GST, Amount | Maru/NumberKeepers add a product code; Pearl/KTC have none. Wrapped descriptions leave the inline cell empty and print above+below the numeric row. |
| **Ordermentum** | Bakery Connect, Ordermentum | ITEM, QTY, PRICE, SUBTOTAL | No product code. `$` prefixes. Leading `*` on some items. |
| **Riverina** | Riverina Fresh | Item Code, Description, Shipped, UOM, Item Price, GST, Line Total | Cleanest of the set — single line, explicit UOM and per-line GST. |
| **Escalate** | Escalate Hospitality | Code, Description, Qty, Price, Amount, GST% | Single line. |
| **Nippon** | Nippon Food Supplies | Code, Maker, Product, Unit, Unit Price, Qty, Amount(ExTax), Tax Code, Tax Amt | Richest data. Barcode line follows some rows. Category headers (`DRY`). |
| **Green Star** | Green Star Food Service | PRODUCT, QUANTITY, DESCRIPTION, UNIT, UNIT PRICE, PRICE | Explicit UNIT (KG/BOX/EACH). Descriptions wrap. Qty printed to 3 decimals. |
| **Foodlink** | Foodlink Australia | No., Description, Qty, UOM, Weight, Unit Price, Disc%, GST, Amount | UOM can be `CTN-5`. |
| **Campos (Sage)** | Campos Coffee | see below | Needs `pdftotext -raw`; `-layout` produces 583-character lines. |

### Campos is the one genuinely awkward format

Sage emits columns in an order that does **not** match its own printed header. The
header reads `ITEM NO. QUANTITY UNIT PRICE DESCRIPTION UOM AMOUNT EX GST`; the actual
field order in `-raw` output is:

```
code  description  AMOUNT_EX_GST  UOM  QUANTITY  TAXCODE  GST_AMT  UNIT_PRICE
```

Verified by arithmetic — `1130170 SUPERIOR 250g BN 244.56 EA 24.00 AUGSF 0.00 10.19`
is 24 × 10.19 = 244.56. Totals also print as bare numbers *above* their labels. Once
those two quirks are encoded, Campos reconciles 18/18.

## Per-supplier extraction result

| Supplier | Invoice PDFs | Reconciled | Line items | Rate |
|---|---:|---:|---:|---:|
| Riverina Fresh | 57 | 57 | 395 | 100% |
| Bakery Connect | 109 | 109 | 571 | 100% |
| Green Star | 89 | 89 | 224 | 100% |
| Maru Food | 27 | 27 | 289 | 100% |
| Campos Coffee | 18 | 18 | 175 | 100% |
| Nippon Food | 17 | 17 | 101 | 100% |
| KTC | 12 | 12 | 31 | 100% |
| Foodlink | 4 | 4 | 24 | 100% |
| NumberKeepers | 4 | 4 | 4 | 100% |
| Ordermentum | 1 | 1 | 9 | 100% |
| Escalate | 1 | 1 | 9 | 100% |
| Pearl Seafoods | 2 | 1 | 1 | 50%¹ |

¹ the failure is a misfiled Bakery Connect PDF, not a format problem.

## Spend coverage — the actual limitation

| Supplier | Stored-PDF value | With product detail | Coverage |
|---|---:|---:|---:|
| KTC | $121,818 | $121,818 | 100%² |
| Green Star | $52,321 | $45,134 | 86% |
| Campos Coffee | $29,340 | $29,340 | 100% |
| Bakery Connect | $26,908 | $22,414 | 83% |
| Maru Food | $27,906 | $22,561 | 81% |
| Riverina Fresh | $18,685 | $18,685 | 100% |
| Nippon Food | $6,446 | $4,759 | 74% |
| Foodlink | $676 | $676 | 100% |
| NumberKeepers | $1,862 | $520 | 28% |
| **Pearl Seafoods** | $36,855 | **$255** | **1%** |
| **Escalate** | $21,852 | **$38** | **0%** |
| **Total** | **$344,668** | **$266,199** | **77%** |

² KTC is shopping-centre rent (Retail Rent / Promotion Levy / Outgoings Levy), not
goods. Excluding it, goods coverage is $144,381 of $222,850 — **65%**.

## Suppliers where the rules cannot be applied — and why

None are blocked by format. Four are blocked by **document supply**.

| Supplier | Records | What actually arrives | Product data possible? |
|---|---:|---|---|
| **Pearl Seafoods** | 117 | 88 of 90 PDFs are STATEMENTS listing other invoices | ~1% — needs supplier change |
| **Escalate Hospitality** | 49 | 31 of 32 PDFs are statements or REMINDER NOTICE letters | ~0% — needs supplier change |
| **Yangzi River** | 23 | All 15 PDFs are "Aged Receivables [Detail]" reports — never an invoice | 0% — needs supplier change |
| **Cn Paultry** | 76 | 75 records have **no `raw_extracted_data` at all** — they were generated from one Customer Statement, not from invoice emails | 0% — needs supplier change |
| Newline Beverage | 6 | no raw data — manual entries | n/a |
| Total Equipment | 8 | 7 emails carried no PDF attachment | n/a |
| AGL | 3 | utility bills, no PDF stored | n/a — not goods |

### Remedies

1. **Ask the four suppliers to email individual tax invoices**, not just monthly
   statements. This is a request to the supplier, not an engineering task, and it is
   the only thing that unlocks Pearl ($36.9k) and Escalate ($21.9k) — together $58.8k
   of spend currently invisible at product level.
2. **Meanwhile, mine the statements for control data.** Statements list invoice number,
   date and amount. That will not give products, but it does give a complete invoice
   register — useful for the completeness check below even without line items.
3. **Cn Paultry** — 75 invoice records were manufactured from a single statement. Worth
   confirming with the supplier whether individual invoices exist at all.

## Data-quality findings (independent of line items)

1. **PDFs attached to the wrong supplier.** Of 90 PDFs filed under Pearl Seafoods, 10
   are Maru Food documents and 1 is Bakery Connect. The AP webhook mis-attributed the
   sender.
2. **Truncated invoice numbers.** Escalate records `INV-000427`, `INV-000428`,
   `INV-000429` — the real numbers are longer (`INV-00042783`…); the remaining digits
   wrapped to the next line in the source PDF and were dropped.
3. **Statements recorded as invoices.** Seven Maru records (INV-7586, 7638, 7773, 8329,
   8376, 9051, 9652) hold a statement PDF rather than the invoice's own. The amounts
   are right — they came from statement rows — but the source document is not the
   invoice, so no products can be recovered for them.
4. **Statement reconciliation is an unused control.** Statements name invoices the
   system may not hold. Matching statement rows against `supplier_invoices` would
   surface both missing invoices and invoices the supplier does not recognise.

## Recommendation on parser strategy

Rule-based extraction with `pdftotext` handles **100% of encountered formats at zero
API cost**, and it is deterministic — the same PDF always yields the same numbers,
and the reconciliation check proves correctness per document.

The AP v2 Claude parser is not needed for these twelve suppliers. Its value is as a
**fallback for unrecognised formats** — a new supplier, or a supplier changing their
template. Suggested design: try the rule, verify against the control total, and only
fall back to the LLM when the rule fails or no rule exists. That keeps cost near zero
while removing the "new supplier breaks everything" failure mode.

Whatever runs, the control-total check should be kept as a permanent gate: a line-item
set that does not add up to the invoice total should never be written to the database.
