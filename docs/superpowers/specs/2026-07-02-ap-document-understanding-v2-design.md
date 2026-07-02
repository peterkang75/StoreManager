# AP Document Understanding v2 — Design Spec

**Date:** 2026-07-02
**Status:** Approved by Peter (2026-07-02)
**Scope:** Replace the Accounts Payable document-understanding layer (classification + parsing + store detection) with a single Claude API vision call. Add line-item extraction & storage.

## 1. Problem

Three chronic AP failures, all rooted in the same layer:

1. **INVOICE vs STATEMENT confusion** (top priority) — classification runs on layout-destroyed plain text via a gpt-4o-mini micro-call (`max_tokens: 8`), separately from field parsing (which has its own `isStatement`), so the two can contradict.
2. **"Invoice To" store detection fails for multi-store suppliers** — store keywords ("olitin", "sushim", "kogarah"…) are hardcoded in the parser prompt (`invoiceParser.ts:162-165`); multi-store suppliers are hardcoded in `MULTI_STORE_SUPPLIER_IDS` (`routes.ts:3833-3840`).
3. **Parsing varies by PDF format** — `pdf-parse` → `pdftotext` text extraction destroys table structure; scanned/image PDFs yield empty text (no OCR) and land in REVIEW.

Ingestion policy (Cloudmailin webhook + supplier email whitelist) is NOT the problem and is retained. Volume is ~50 emails/month, so cost/load are not constraints; quality is.

A planned future feature — product line-item extraction and price tracking — depends on table-accurate parsing, which the current text-extraction pipeline cannot provide. Line-item capture is included in this scope; product normalization/price-tracking UI is not.

## 2. What stays / what changes

**Unchanged:** Cloudmailin webhook (`POST /api/webhooks/inbound-invoices`), sender resolution, whitelist gate (`suppliers.contactEmails`), `rejectedEmails` promote flow, dedup, status machine (PENDING/PAID/REVIEW/QUARANTINE/DELETED), isAutoPay, intercompany logic, admin UI structure.

**Replaced:** In `server/invoiceParser.ts` — the pipeline `extractPdfText` → `classifyDocumentForAP` (gpt-4o-mini) → `parseInvoiceWithAI` (gpt-4o-mini) becomes **one Claude API call** per attachment.

**New:** `invoice_line_items` table; `suppliers.isMultiStore` column; confidence/reasoning stored in `rawExtractedData` and shown in the Review UI; regression eval script; `AP_PARSER` env flag.

## 3. New parser design

### 3.1 Input

- PDF sent as base64 `document` content block (native PDF support — Claude sees each page as text + image; handles scans, tables, layout). Images (JPG/PNG) sent as `image` blocks.
- Prompt context injected from DB (not hardcoded):
  - Store profiles: name, code, address, `stores.bodyAliases` (aliases, account numbers, DBA names) for every active internal store.
  - Supplier hint: whitelist-matched supplier name + `isMultiStore` flag.
  - Email subject + body snippet.

### 3.2 Model & API

- Model: `claude-opus-4-8`, adaptive thinking, structured output (`output_config.format` json_schema) so the response always validates.
- SDK: `@anthropic-ai/sdk` (TypeScript). New env var `ANTHROPIC_API_KEY` (Railway).
- Estimated cost: ~$0.05–0.10 per attachment ≈ **$5/month** at current volume.

### 3.3 Output schema (single call, no contradictions possible)

```ts
{
  docType: "INVOICE" | "STATEMENT" | "REMITTANCE" | "OTHER",
  supplierName: string,            // as printed on the document
  abn: string | null,
  store: string | "UNKNOWN",      // store NAME (e.g. "Sushi", "Sandwich") resolved from injected profiles — codes in this DB are numeric and ambiguous
  confidence: { docType: number, store: number, fields: number },  // 0–1
  reasoning: string,               // 1–2 sentences: why this docType/store
  invoices: [{
    invoiceNumber: string,
    issueDate: string,             // YYYY-MM-DD
    dueDate: string | null,
    totalAmount: number,
    lineItems: [{                  // empty for STATEMENT rows
      description: string,
      sku: string | null,
      qty: number | null,
      unit: string | null,
      unitPrice: number | null,
      lineTotal: number,
      gst: number | null
    }]
  }]
}
```

STATEMENT → multiple `invoices[]` rows, no lineItems. Classification and extraction come from the same call, eliminating the classify/parse contradiction class of bugs.

## 4. DB changes (drizzle)

| Change | Detail |
|---|---|
| New table `invoice_line_items` | `id (uuid PK)`, `invoiceId (FK → supplier_invoices, cascade delete)`, `description`, `sku`, `qty (real)`, `unit`, `unitPrice (real)`, `lineTotal (real)`, `gstAmount (real)`, `createdAt`. Populated from day one; price-tracking UI consumes it later. |
| `suppliers.isMultiStore boolean default false` | Replaces hardcoded `MULTI_STORE_SUPPLIER_IDS`; editable in supplier admin UI. One-time data migration sets it true for Escalate Hospitality Supplies. |
| `supplier_invoices` | No schema change. `confidence` + `reasoning` stored inside existing `rawExtractedData` JSONB. |

## 5. Routing (wired into existing status machine)

- `store === "UNKNOWN"` or `confidence.store < 0.7` → `storeId = null`, existing fallbacks still run (bodyAliases scan, delivery match, history for single-store suppliers); unresolved → manager assigns manually.
- `confidence.docType < 0.7` → force REVIEW (never silently drop).
- REMITTANCE / OTHER → skip (as today).
- `reasoning` displayed on REVIEW rows in AccountsPayable.tsx so manual fixes are fast.
- Amount $0 → REVIEW (unchanged). Duplicate check by `(supplierId, invoiceNumber)` (unchanged).

## 6. Verification & rollout

1. **Regression eval script** (`script/eval-ap-parser.ts`): replay stored `rawExtractedData.pdfBase64` from historical `supplier_invoices` through the new parser; compare docType / store / invoiceNumber / totalAmount against the human-corrected DB values; print accuracy report (old pipeline's originally-parsed values vs new parser vs ground truth).
2. **Env flag `AP_PARSER=claude|openai`** — default `openai` until eval passes; old OpenAI path retained untouched for instant rollback.
3. Flip flag in Railway after eval sign-off. Remove old path in a later cleanup once stable.

## 7. Error handling

- Claude API failure (timeout/429/5xx) after SDK retries → create REVIEW placeholder (same as today's unreadable-PDF path). Webhook always returns 200; no mail loss.
- Structured output means no JSON-recovery code needed; the old truncation-recovery block is not ported.
- Oversized PDFs (>32MB request / >100 pages): fall back to REVIEW placeholder with a note.

## 8. Out of scope

- Product catalog, product identity matching, price-tracking UI (separate project; `invoice_line_items` is designed to feed it).
- Claude Cowork mailbox supervision (optional later add-on: weekly sweep for missed supplier emails).
- Any change to ingestion policy (whitelist stays).
