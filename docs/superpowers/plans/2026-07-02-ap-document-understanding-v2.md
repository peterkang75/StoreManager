# AP Document Understanding v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AP email pipeline's document-understanding layer (text-extract → gpt-4o-mini classify → gpt-4o-mini parse) with a single Claude API vision call that classifies, extracts fields, detects the store, and extracts product line items — behind an `AP_PARSER` env flag with the old path retained for rollback.

**Architecture:** New module `server/apDocumentParser.ts` sends the PDF/image as a base64 document block to `claude-opus-4-8` with structured output (zod schema via `messages.parse`). Store profiles (names/addresses/bodyAliases) and the supplier's multi-store flag are injected from the DB — no hardcoded keywords. The webhook (`routes.ts` `/api/webhooks/inbound-invoices`) branches on `process.env.AP_PARSER === "claude"`. Line items land in a new `invoice_line_items` table. A regression eval script replays historical PDFs stored in `rawExtractedData.pdfBase64` to measure accuracy before the flag is flipped in production.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), `@anthropic-ai/sdk` (new dep), zod 3 (existing), React admin UI.

**Spec:** `docs/superpowers/specs/2026-07-02-ap-document-understanding-v2-design.md`

## Global Constraints

- Model string exactly `claude-opus-4-8`. Thinking: `{ type: "adaptive" }`. No `temperature`/`top_p` (400 on this model).
- Env vars: `ANTHROPIC_API_KEY` (new), `AP_PARSER` = `claude` | `openai`, **default `openai`** when unset.
- The old OpenAI path in `invoiceParser.ts` must remain fully functional — do not delete or modify existing exported functions.
- No test framework exists in this repo. Verification = `npx tsc` (only check the files you touched — the repo has pre-existing unrelated tsc errors in AccountsPayable.tsx/Dashboard.tsx/routes.ts; your changes must not ADD new errors) + `tsx` smoke/eval scripts.
- DB pushes: `npm run db:push` runs against the DB in `DATABASE_URL`. For production Railway Postgres, coordinate with the user before pushing (production writes need explicit approval).
- Webhook must always return HTTP 200 to Cloudmailin, even on parser failure.
- Commit after each task (commit includes push — user convention).

---

### Task 1: Schema — `invoice_line_items` table + `suppliers.isMultiStore`

**Files:**
- Modify: `shared/schema.ts` (suppliers table ~line 437-462; add new table after `supplierPayments` block ~line 530)

**Interfaces:**
- Produces: `invoiceLineItems` pgTable, `insertInvoiceLineItemSchema`, types `InvoiceLineItem` / `InsertInvoiceLineItem`; `suppliers.isMultiStore` boolean column. Consumed by Tasks 2, 4, 5.

- [ ] **Step 1: Add `isMultiStore` to suppliers table**

In `shared/schema.ts`, inside `export const suppliers = pgTable("suppliers", {...})`, after the `isAutoPay` line (line ~450), add:

```typescript
  // AP v2: supplier delivers to MULTIPLE stores (e.g. Escalate Hospitality Supplies).
  // When true, store detection must come from the document itself ("Invoice To"),
  // never from this supplier's invoice history. Replaces the old hardcoded
  // MULTI_STORE_SUPPLIER_IDS set in routes.ts.
  isMultiStore: boolean("is_multi_store").default(false).notNull(),
```

- [ ] **Step 2: Add `invoiceLineItems` table**

In `shared/schema.ts`, immediately after the `supplierPayments` insert-schema/type block, add:

```typescript
// AP v2: product line items extracted from invoice PDFs (feeds future price tracking).
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").references(() => supplierInvoices.id, { onDelete: "cascade" }).notNull(),
  description: text("description").notNull(),
  sku: text("sku"),
  qty: real("qty"),
  unit: text("unit"),
  unitPrice: real("unit_price"),
  lineTotal: real("line_total").default(0).notNull(),
  gstAmount: real("gst_amount"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
```

(`real`, `varchar`, `text`, `timestamp`, `boolean`, `sql`, `createInsertSchema`, `z` are already imported at the top of schema.ts.)

- [ ] **Step 3: Type-check**

Run: `npx tsc 2>&1 | grep "schema.ts" || echo "schema.ts clean"`
Expected: `schema.ts clean`

- [ ] **Step 4: Push schema to DB**

⚠️ `DATABASE_URL` in `.env.local` may be stale (see memory: prod DB is Railway). **Ask the user which DB to push to before running.** For local/dev:

Run: `npm run db:push`
Expected: drizzle reports adding `invoice_line_items` table and `is_multi_store` column, no destructive changes.

Then set the flag for the known multi-store supplier (read-only check first):

```sql
SELECT id, name FROM suppliers WHERE id = '6b80f712-4079-4836-8613-d78511698645';
UPDATE suppliers SET is_multi_store = true WHERE id = '6b80f712-4079-4836-8613-d78511698645';
```

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts
git commit -m "AP v2: invoice_line_items table + suppliers.isMultiStore flag"
git push
```

---

### Task 2: Storage methods for line items

**Files:**
- Modify: `server/storage.ts` — `IStorage` interface (~line 200 area, near `createSupplierInvoice`), `MemStorage` class (starts line 373), `DatabaseStorage` class (starts line 2140)

**Interfaces:**
- Consumes: `invoiceLineItems`, `InsertInvoiceLineItem`, `InvoiceLineItem` from Task 1.
- Produces: `storage.createInvoiceLineItems(invoiceId: string, items: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<InvoiceLineItem[]>` and `storage.getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]>`. Consumed by Task 4.

- [ ] **Step 1: Add imports**

In the big import block at the top of `server/storage.ts`, add (alongside the other type pairs):

```typescript
  type InvoiceLineItem, type InsertInvoiceLineItem, invoiceLineItems,
```

- [ ] **Step 2: Add to `IStorage` interface** (next to the supplier-invoice methods ~line 202):

```typescript
  createInvoiceLineItems(invoiceId: string, items: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<InvoiceLineItem[]>;
  getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]>;
```

- [ ] **Step 3: Implement in `MemStorage`** (add a map field near the class's other maps, and methods near `createSupplierInvoice` ~line 1202):

```typescript
  private invoiceLineItemsMap: Map<string, InvoiceLineItem> = new Map();

  async createInvoiceLineItems(invoiceId: string, items: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<InvoiceLineItem[]> {
    const created: InvoiceLineItem[] = [];
    for (const item of items) {
      const row: InvoiceLineItem = {
        id: randomUUID(),
        invoiceId,
        description: item.description,
        sku: item.sku ?? null,
        qty: item.qty ?? null,
        unit: item.unit ?? null,
        unitPrice: item.unitPrice ?? null,
        lineTotal: item.lineTotal ?? 0,
        gstAmount: item.gstAmount ?? null,
        createdAt: new Date(),
      };
      this.invoiceLineItemsMap.set(row.id, row);
      created.push(row);
    }
    return created;
  }

  async getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
    return Array.from(this.invoiceLineItemsMap.values()).filter((r) => r.invoiceId === invoiceId);
  }
```

- [ ] **Step 4: Implement in `DatabaseStorage`** (near its `createSupplierInvoice` ~line 2995):

```typescript
  async createInvoiceLineItems(invoiceId: string, items: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<InvoiceLineItem[]> {
    if (items.length === 0) return [];
    return db.insert(invoiceLineItems).values(items.map((item) => ({ ...item, invoiceId }))).returning();
  }

  async getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
    return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc 2>&1 | grep -c "storage.ts" ` — compare against the count BEFORE your change (run it first on a clean tree). Expected: no new storage.ts errors.

- [ ] **Step 6: Commit**

```bash
git add server/storage.ts
git commit -m "AP v2: storage methods for invoice line items"
git push
```

---

### Task 3: Claude parser module `server/apDocumentParser.ts`

**Files:**
- Create: `server/apDocumentParser.ts`
- Create: `script/smoke-ap-parser.ts` (manual smoke test)
- Modify: `package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Produces (consumed by Tasks 4 and 6):

```typescript
export type ApDocType = "INVOICE" | "STATEMENT" | "REMITTANCE" | "OTHER";
export interface ApLineItem { description: string; sku: string | null; qty: number | null; unit: string | null; unitPrice: number | null; lineTotal: number; gst: number | null; }
export interface ApParsedInvoice { invoiceNumber: string; issueDate: string; dueDate: string | null; totalAmount: number; lineItems: ApLineItem[]; }
export interface ApParseResult {
  docType: ApDocType;
  supplierName: string;
  abn: string | null;
  store: string;   // exact store NAME from injected profiles, or "UNKNOWN"
  confidence: { docType: number; store: number; fields: number };  // 0-1
  reasoning: string;
  invoices: ApParsedInvoice[];
}
export interface ApStoreProfile { name: string; address: string | null; aliases: string[]; }
export interface ApParseInput {
  fileBase64?: string;                 // PDF or image, base64 without data: prefix
  mediaType?: "application/pdf" | "image/jpeg" | "image/png";
  textContent?: string;                // body-text fallback (no attachment)
  supplierHint: string;
  supplierIsMultiStore: boolean;
  subject: string;
  storeProfiles: ApStoreProfile[];
}
export async function parseApDocument(input: ApParseInput): Promise<ApParseResult | null>;
```

- [ ] **Step 1: Install SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: added to package.json dependencies without errors.

- [ ] **Step 2: Write the module**

Create `server/apDocumentParser.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Client is lazy so the server still boots when ANTHROPIC_API_KEY is absent
// (old-parser deployments don't need it).
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set — required when AP_PARSER=claude");
    }
    _client = new Anthropic();
  }
  return _client;
}

export type ApDocType = "INVOICE" | "STATEMENT" | "REMITTANCE" | "OTHER";

export interface ApLineItem {
  description: string; sku: string | null; qty: number | null; unit: string | null;
  unitPrice: number | null; lineTotal: number; gst: number | null;
}
export interface ApParsedInvoice {
  invoiceNumber: string; issueDate: string; dueDate: string | null;
  totalAmount: number; lineItems: ApLineItem[];
}
export interface ApParseResult {
  docType: ApDocType; supplierName: string; abn: string | null; store: string;
  confidence: { docType: number; store: number; fields: number };
  reasoning: string; invoices: ApParsedInvoice[];
}
export interface ApStoreProfile { name: string; address: string | null; aliases: string[]; }
export interface ApParseInput {
  fileBase64?: string;
  mediaType?: "application/pdf" | "image/jpeg" | "image/png";
  textContent?: string;
  supplierHint: string;
  supplierIsMultiStore: boolean;
  subject: string;
  storeProfiles: ApStoreProfile[];
}

const LineItemSchema = z.object({
  description: z.string(),
  sku: z.string().nullable(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.number().nullable(),
  lineTotal: z.number(),
  gst: z.number().nullable(),
});

const ParsedInvoiceSchema = z.object({
  invoiceNumber: z.string(),
  issueDate: z.string().describe("YYYY-MM-DD; empty string if not found"),
  dueDate: z.string().nullable(),
  totalAmount: z.number(),
  lineItems: z.array(LineItemSchema),
});

const ParseResultSchema = z.object({
  docType: z.enum(["INVOICE", "STATEMENT", "REMITTANCE", "OTHER"]),
  supplierName: z.string(),
  abn: z.string().nullable(),
  store: z.string(),
  confidence: z.object({
    docType: z.number(),
    store: z.number(),
    fields: z.number(),
  }),
  reasoning: z.string(),
  invoices: z.array(ParsedInvoiceSchema),
});

function buildSystemPrompt(input: ApParseInput): string {
  const storeList = input.storeProfiles
    .map((s) => `- "${s.name}"${s.address ? ` — address: ${s.address}` : ""}${s.aliases.length ? ` — known aliases/identifiers: ${s.aliases.join("; ")}` : ""}`)
    .join("\n");

  return `You are the accounts-payable document analyst for an Australian multi-store hospitality business.
You receive one supplier document (PDF, image, or email text). Analyze it VISUALLY and structurally, then return structured JSON.

## 1. Document type (docType)
- INVOICE: a single payable bill for one order/delivery. One invoice number in the header; table rows are PRODUCTS/SERVICES (Description, Qty, Unit Price, GST, Amount). A tear-off "PAYMENT ADVICE" slip at the bottom does NOT make it a statement — still INVOICE.
- STATEMENT: a "Statement of Account" summarizing MULTIPLE invoices — table rows are INVOICE REFERENCES (invoice no, date, amount, running balance), not products.
- REMITTANCE: a remittance advice from a payer announcing funds transferred. No amount due.
- OTHER: order confirmation, delivery docket, quote, receipt, marketing.

## 2. Field extraction
- INVOICE → exactly one entry in "invoices", with its product lineItems (description, sku/code if printed, qty, unit e.g. KG/EA/CTN, unitPrice, lineTotal, gst per line if shown; use null when a column is absent). totalAmount = final amount INCLUDING GST.
- STATEMENT → one entry in "invoices" PER LISTED INVOICE ROW (lineItems empty for each). NEVER return the statement's grand total as a single invoice.
- REMITTANCE/OTHER → "invoices" must be [].
- Dates as YYYY-MM-DD (Australian documents: DD/MM/YYYY means day first). Unknown date → empty string; unknown dueDate → null.
- supplierName: the SELLER as printed on the document. For aggregator platforms (Ordermentum, Fresho…) return the real underlying vendor, not the platform. Never return the buyer's name${input.supplierHint ? ` (buyer entities relate to the stores below)` : ""}.

## 3. Store (buyer) detection
Our stores:
${storeList}

Find who the document is billed/delivered to ("Invoice To", "Bill To", "Deliver To", "Attention", customer account name/number, delivery address) and match it to ONE store name above, using names, addresses, and aliases. Return the EXACT store name string, or "UNKNOWN" if genuinely ambiguous.
${input.supplierIsMultiStore ? `IMPORTANT: this supplier delivers to MULTIPLE of our stores — decide ONLY from this document's bill-to/deliver-to content, never assume.` : ""}

## 4. Confidence & reasoning
- confidence.docType / .store / .fields: 0.0–1.0 honest estimates. If the bill-to block is missing or ambiguous, confidence.store must be ≤ 0.5.
- reasoning: 1–2 short sentences naming the concrete evidence ("Header says TAX INVOICE with product rows; Deliver To: 2/62 Railway Pde matches Sandwich").

Email subject: ${JSON.stringify(input.subject || "")}
Supplier hint from sender whitelist: ${JSON.stringify(input.supplierHint || "")} (a hint, not ground truth — trust the document).`;
}

/**
 * Single-call document understanding: classify + extract + store-detect.
 * Returns null on API failure (caller falls back to REVIEW placeholder).
 */
export async function parseApDocument(input: ApParseInput): Promise<ApParseResult | null> {
  try {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.fileBase64 && input.mediaType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: input.fileBase64 },
      });
    } else if (input.fileBase64 && input.mediaType) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: input.mediaType, data: input.fileBase64 },
      });
    } else if (input.textContent) {
      content.push({ type: "text", text: `--- EMAIL BODY (no attachment) ---\n${input.textContent.slice(0, 30000)}` });
    } else {
      return null;
    }
    content.push({ type: "text", text: "Analyze this document and return the structured result." });

    const response = await client().messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: buildSystemPrompt(input),
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ParseResultSchema) },
    });

    if (!response.parsed_output) {
      console.warn(`[apDocumentParser] parse returned no output (stop_reason=${response.stop_reason})`);
      return null;
    }
    return response.parsed_output as ApParseResult;
  } catch (err: any) {
    console.error("[apDocumentParser] Claude parse failed:", err?.message ?? err);
    return null;
  }
}
```

- [ ] **Step 3: Write the smoke script**

Create `script/smoke-ap-parser.ts`:

```typescript
// Usage: ANTHROPIC_API_KEY=... npx tsx script/smoke-ap-parser.ts <path-to-pdf>
import fs from "fs";
import { parseApDocument } from "../server/apDocumentParser";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) { console.error("Usage: tsx script/smoke-ap-parser.ts <pdf>"); process.exit(1); }
  const result = await parseApDocument({
    fileBase64: fs.readFileSync(pdfPath).toString("base64"),
    mediaType: "application/pdf",
    supplierHint: "Test Supplier",
    supplierIsMultiStore: true,
    subject: "smoke test",
    storeProfiles: [
      { name: "Sushi", address: "Kogarah NSW", aliases: ["Olitin", "Sushim"] },
      { name: "Sandwich", address: null, aliases: ["Eatem"] },
      { name: "Trading", address: null, aliases: [] },
      { name: "HO", address: null, aliases: ["Head Office"] },
    ],
  });
  console.log(JSON.stringify(result, null, 2));
}
main();
```

- [ ] **Step 4: Type-check**

Run: `npx tsc 2>&1 | grep "apDocumentParser\|smoke-ap-parser" || echo "clean"`
Expected: `clean`

- [ ] **Step 5: Smoke test with a real PDF** (needs `ANTHROPIC_API_KEY` in env; any supplier invoice PDF works — export one from the admin UI or use a file on disk)

Run: `npx tsx script/smoke-ap-parser.ts /path/to/sample-invoice.pdf`
Expected: JSON with a plausible `docType`, `store`, `invoices[0].totalAmount > 0`, non-empty `reasoning`. If no local PDF is available, defer this to Task 6 (eval replays real PDFs from the DB) and note it.

- [ ] **Step 6: Commit**

```bash
git add server/apDocumentParser.ts script/smoke-ap-parser.ts package.json package-lock.json
git commit -m "AP v2: Claude vision document parser (single-call classify+extract+store)"
git push
```

---

### Task 4: Webhook integration behind `AP_PARSER` flag

**Files:**
- Modify: `server/routes.ts` — attachment loop (lines ~6683-6837), body-text fallback (~6591-6656), `resolveStoreIdForInvoice` (~3833-3874), imports (top of file)

**Interfaces:**
- Consumes: `parseApDocument`, `ApParseResult`, `ApStoreProfile` (Task 3); `storage.createInvoiceLineItems` (Task 2); `suppliers.isMultiStore` (Task 1).
- Produces: no new exports. Behavior: when `AP_PARSER=claude`, each attachment gets ONE `parseApDocument` call; docType/items/store/lineItems all derive from it. When unset/`openai`, behavior is byte-identical to today.

- [ ] **Step 1: Import the new parser** at the top of `routes.ts` (next to the existing `invoiceParser` imports):

```typescript
import { parseApDocument, type ApParseResult, type ApStoreProfile } from "./apDocumentParser";
```

- [ ] **Step 2: Replace hardcoded multi-store set with the DB flag**

In `resolveStoreIdForInvoice` (~line 3833): delete the `MULTI_STORE_SUPPLIER_IDS` constant and change the history-guard condition. The existing code:

```typescript
  const MULTI_STORE_SUPPLIER_IDS = new Set<string>([
    "6b80f712-4079-4836-8613-d78511698645", // Escalate Hospitality Supplies
  ]);
  ...
    if (opts.supplierId && !MULTI_STORE_SUPPLIER_IDS.has(opts.supplierId)) {
```

becomes:

```typescript
    if (opts.supplierId) {
      const sup = await storage.getSupplier(opts.supplierId);
      if (!sup?.isMultiStore) {
        // ...existing history logic unchanged, nested one level deeper
      }
    }
```

(Check `storage.getSupplier` exists — it does, used elsewhere in routes.ts; if the exact name differs, use the single-supplier getter already used by `PUT /api/suppliers/:id`.) This step is flag-independent: same behavior as before, just DB-driven.

- [ ] **Step 3: Add a store-profile builder + claude-branch helper inside the webhook handler**

Right before the attachment loop (~line 6682), add:

```typescript
      const useClaudeParser = process.env.AP_PARSER === "claude";
      const apStoreProfiles: ApStoreProfile[] = allStores
        .filter((s: any) => s.active && !s.isExternal)
        .map((s: any) => ({
          name: s.name,
          address: s.address ?? null,
          aliases: (s.bodyAliases ?? []).filter(Boolean),
        }));
      const resolveStoreByName = (storeName: string): string | null => {
        if (!storeName || storeName === "UNKNOWN") return null;
        return allStores.find((s: any) => s.name.toLowerCase() === storeName.toLowerCase())?.id ?? null;
      };
```

(`allStores` is already in scope in the handler; verify and reuse. `stores.address` — check the stores table has an address column; if not, pass `null`.)

- [ ] **Step 4: Branch the attachment loop**

Inside the loop (after `extractPdfFromAttachment`, ~line 6689), when `useClaudeParser` is true, SKIP `classifyDocumentForAP` + `parseInvoiceWithAI` and instead build everything from one call. Structure (keep the old code in the `else` branch untouched):

```typescript
        let docType: string;
        let parsedItems: any[] | null;      // legacy shape consumed by Steps 6-7 below
        let apResult: ApParseResult | null = null;

        if (useClaudeParser) {
          // Raw base64 comes from the attachment itself; text extraction not needed.
          const rawBase64: string | null = pdfResult?.pdfBase64
            ?? (typeof (att.content ?? att.data ?? att.body) === "string" ? (att.content ?? att.data ?? att.body) : null);
          const isPdf = attName.toLowerCase().endsWith(".pdf") || String(att.content_type ?? "").includes("pdf");
          apResult = rawBase64
            ? await parseApDocument({
                fileBase64: rawBase64,
                mediaType: isPdf ? "application/pdf" : (attName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
                supplierHint: matchedSupplier.name,
                supplierIsMultiStore: (matchedSupplier as any).isMultiStore ?? false,
                subject,
                storeProfiles: apStoreProfiles,
              })
            : null;
          if (!apResult) {
            // API failure or unreadable attachment → REVIEW placeholder (same as legacy unreadable path)
            docType = "INVOICE";
            parsedItems = null;
          } else {
            docType = apResult.confidence.docType < 0.7 ? "INVOICE" : apResult.docType;  // low confidence → don't silently skip
            parsedItems = apResult.invoices.map((inv) => ({
              invoiceNumber: inv.invoiceNumber,
              issueDate: inv.issueDate,
              dueDate: inv.dueDate,
              totalAmount: inv.totalAmount,
              storeCode: "UNKNOWN",                    // legacy field unused in claude path
              extractedSupplierName: apResult!.supplierName,
              abn: apResult!.abn,
              deliveryLocation: null,
              isStatement: apResult!.docType === "STATEMENT",
              _lineItems: inv.lineItems,               // carried through to creation step
            }));
          }
        } else {
          docType = await classifyDocumentForAP(classifyText || "no text available");
          // ...existing classify/skip/unreadable/parse code EXACTLY as today...
          parsedItems = /* existing parseInvoiceWithAI result */;
        }
```

Adapt the existing Step-3/4/5 blocks so both branches converge on `docType` + `parsedItems`. REMITTANCE/OTHER skip logic runs the same for both branches — but in the claude branch, only skip when `apResult` is non-null (confidence gate above already handles the low-confidence case).

- [ ] **Step 5: Store resolution + rawExtractedData in the claude path**

In the invoice-creation section (~line 6792), when `useClaudeParser && apResult`:

```typescript
          const storeId = (apResult && apResult.confidence.store >= 0.7 ? resolveStoreByName(apResult.store) : null)
            ?? resolveStoreFromBodyAliases(`${pdfResult?.text ?? ""}\n${emailBody ?? ""}`)
            ?? null;
```

and extend `rawExtractedData` for created rows with:

```typescript
            rawExtractedData: {
              pdfBase64: pdfResult?.pdfBase64 ?? null, senderEmail, subject,
              _parser: "claude",
              _confidence: apResult?.confidence ?? null,
              _reasoning: apResult?.reasoning ?? null,
            },
```

Keep the legacy branch's `rawExtractedData` unchanged.

- [ ] **Step 6: Insert line items after invoice creation**

Immediately after `const newInv = await storage.createSupplierInvoice({...})` (~line 6811), add:

```typescript
          const lineItems = (parsed as any)._lineItems as any[] | undefined;
          if (useClaudeParser && lineItems && lineItems.length > 0 && !(parsed as any).isStatement) {
            try {
              await storage.createInvoiceLineItems(newInv.id, lineItems.map((li) => ({
                description: li.description, sku: li.sku, qty: li.qty, unit: li.unit,
                unitPrice: li.unitPrice, lineTotal: li.lineTotal, gstAmount: li.gst,
              })));
            } catch (liErr: any) {
              console.warn(`[Webhook] line-item insert failed for ${newInv.id}:`, liErr?.message ?? liErr);
            }
          }
```

- [ ] **Step 7: Body-text fallback branch** (~line 6594): when `useClaudeParser`, replace the `classifyDocumentForAP` + `parseInvoiceWithAI` pair with one call:

```typescript
            const bodyResult = useClaudeParser
              ? await parseApDocument({
                  textContent: bodyTrim, supplierHint: matchedSupplier.name,
                  supplierIsMultiStore: (matchedSupplier as any).isMultiStore ?? false,
                  subject, storeProfiles: apStoreProfiles,
                })
              : null;
```

then map `bodyResult.invoices[0]` to the existing `first` shape when in claude mode (same fields as Step 4's mapping); legacy mode keeps the existing code path.

- [ ] **Step 8: Type-check + boot test**

Run: `npx tsc 2>&1 | grep -c "routes.ts"` — must not exceed the pre-change count.
Run: `npm run dev` briefly (no ANTHROPIC_API_KEY needed since AP_PARSER unset) — server must boot cleanly. Kill it.

- [ ] **Step 9: Commit**

```bash
git add server/routes.ts
git commit -m "AP v2: webhook claude-parser branch behind AP_PARSER flag; DB-driven multi-store flag"
git push
```

---

### Task 5: Admin UI — reasoning on REVIEW rows + isMultiStore toggle

**Files:**
- Modify: `client/src/pages/admin/AccountsPayable.tsx` — supplier form (~lines 364-445, where `isAutoPay` state lives), REVIEW row rendering (find where `rawExtractedData` / review-queue rows render)

**Interfaces:**
- Consumes: `suppliers.isMultiStore` (Task 1) via existing supplier CRUD endpoints; `rawExtractedData._reasoning` / `_confidence` (Task 4).
- Produces: UI only.

- [ ] **Step 1: Supplier edit dialog — add Multi-store checkbox**

Mirror the existing `isAutoPay` pattern exactly (state at ~line 377, populate at ~437, include in the save payload). Add:

```tsx
const [isMultiStore, setIsMultiStore] = useState(false);
// populate: setIsMultiStore(sup.isMultiStore ?? false);
// payload: isMultiStore,
```

UI (next to the Auto-pay checkbox, same styling):

```tsx
<div className="flex items-center gap-2">
  <Checkbox id="multi-store" checked={isMultiStore} onCheckedChange={(v) => setIsMultiStore(v === true)} data-testid="checkbox-multi-store" />
  <Label htmlFor="multi-store" className="text-sm">Multi-store supplier (store must come from the invoice itself)</Label>
</div>
```

Verify the backend `PUT /api/suppliers/:id` passes arbitrary schema fields through (it uses `insertSupplierSchema`-based update — `isMultiStore` is in the schema after Task 1, so it flows automatically; confirm by checking the route handler).

- [ ] **Step 2: REVIEW rows — show parser reasoning**

In the Review Queue row expansion/detail (locate the block rendering `inv.notes` for REVIEW status), add below the notes:

```tsx
{(inv.rawExtractedData as any)?._reasoning && (
  <p className="text-xs text-muted-foreground italic mt-1" data-testid={`text-parser-reasoning-${inv.id}`}>
    AI: {(inv.rawExtractedData as any)._reasoning}
    {(inv.rawExtractedData as any)?._confidence
      ? ` (doc ${Math.round(((inv.rawExtractedData as any)._confidence.docType ?? 0) * 100)}% / store ${Math.round(((inv.rawExtractedData as any)._confidence.store ?? 0) * 100)}%)`
      : ""}
  </p>
)}
```

If `rawExtractedData` isn't currently sent to the client for review rows, extend the review-queue GET endpoint to include only `_reasoning` and `_confidence` (NOT `pdfBase64` — it's huge).

- [ ] **Step 3: Type-check + visual check**

Run: `npx tsc 2>&1 | grep -c "AccountsPayable.tsx"` — must not exceed pre-change count (file has pre-existing errors).
Run the dev server, open Accounts Payable → supplier edit dialog shows the new checkbox; toggle + save + reopen persists.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/AccountsPayable.tsx server/routes.ts
git commit -m "AP v2: multi-store supplier toggle + parser reasoning in Review UI"
git push
```

---

### Task 6: Regression eval script

**Files:**
- Create: `script/eval-ap-parser.ts`

**Interfaces:**
- Consumes: `parseApDocument` (Task 3), DB via `DATABASE_URL` (read-only queries).
- Produces: console accuracy report. No production writes.

- [ ] **Step 1: Write the eval script**

```typescript
// Replays historical invoice PDFs (rawExtractedData.pdfBase64) through the new
// Claude parser and compares against the human-corrected DB values.
// READ-ONLY. Usage:
//   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx script/eval-ap-parser.ts [limit]
import { db } from "../server/db";
import { supplierInvoices, suppliers, stores } from "../shared/schema";
import { isNotNull, inArray, eq } from "drizzle-orm";
import { parseApDocument, type ApStoreProfile } from "../server/apDocumentParser";

async function main() {
  const limit = parseInt(process.argv[2] ?? "30", 10);
  const allStores = await db.select().from(stores);
  const storeProfiles: ApStoreProfile[] = allStores
    .filter((s) => s.active && !s.isExternal)
    .map((s) => ({ name: s.name, address: (s as any).address ?? null, aliases: (s.bodyAliases ?? []).filter(Boolean) as string[] }));
  const storeNameById = new Map(allStores.map((s) => [s.id, s.name]));

  const rows = await db.select().from(supplierInvoices)
    .where(inArray(supplierInvoices.status, ["PENDING", "PAID"]));  // human-verified ground truth
  const withPdf = rows.filter((r) => (r.rawExtractedData as any)?.pdfBase64).slice(0, limit);
  console.log(`Evaluating ${withPdf.length} historical invoices (of ${rows.length} candidates)...`);

  let storeHit = 0, storeMiss = 0, storeUnknown = 0;
  let amountHit = 0, amountMiss = 0;
  let numHit = 0, numMiss = 0;
  let statementFlags = 0, failures = 0;

  for (const row of withPdf) {
    const raw = row.rawExtractedData as any;
    const sup = row.supplierId ? (await db.select().from(suppliers).where(eq(suppliers.id, row.supplierId)))[0] : null;
    const result = await parseApDocument({
      fileBase64: raw.pdfBase64,
      mediaType: "application/pdf",
      supplierHint: sup?.name ?? "",
      supplierIsMultiStore: (sup as any)?.isMultiStore ?? false,
      subject: raw.subject ?? "",
      storeProfiles,
    });
    if (!result) { failures++; console.log(`✗ ${row.invoiceNumber}: PARSE FAILED`); continue; }

    const truthStore = row.storeId ? storeNameById.get(row.storeId) ?? "?" : null;
    const gotStore = result.confidence.store >= 0.7 ? result.store : "UNKNOWN";
    if (truthStore) {
      if (gotStore === truthStore) storeHit++;
      else if (gotStore === "UNKNOWN") storeUnknown++;
      else { storeMiss++; console.log(`✗ STORE ${row.invoiceNumber}: expected ${truthStore}, got ${gotStore} — "${result.reasoning}"`); }
    }
    const gotInv = result.invoices.find((i) => i.invoiceNumber === row.invoiceNumber) ?? result.invoices[0];
    if (gotInv && Math.abs(gotInv.totalAmount - row.amount) < 0.01) amountHit++;
    else { amountMiss++; console.log(`✗ AMOUNT ${row.invoiceNumber}: expected ${row.amount}, got ${gotInv?.totalAmount ?? "-"}`); }
    if (gotInv && gotInv.invoiceNumber === row.invoiceNumber) numHit++; else numMiss++;
    if (result.docType === "STATEMENT") statementFlags++;
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Store:   ${storeHit} hit / ${storeMiss} WRONG / ${storeUnknown} unknown(safe)`);
  console.log(`Amount:  ${amountHit} hit / ${amountMiss} miss`);
  console.log(`Inv#:    ${numHit} hit / ${numMiss} miss`);
  console.log(`Statements flagged: ${statementFlags}, hard failures: ${failures}`);
  process.exit(0);
}
main();
```

(Verify `server/db.ts` exports `db`; adjust the import if the export lives elsewhere. `isNotNull` import may be unused — drop it if so.)

- [ ] **Step 2: Type-check**

Run: `npx tsc 2>&1 | grep "eval-ap-parser" || echo clean` → `clean`

- [ ] **Step 3: Run against production data (read-only) — ASK USER FIRST**

Production DB reads require user approval per session. With approval:

Run: `DATABASE_URL=<railway-public-url> ANTHROPIC_API_KEY=... npx tsx script/eval-ap-parser.ts 30`
Expected: report prints. **Success bar: 0 WRONG stores (unknown is acceptable), ≥90% amount hit, 0 hard failures.** Investigate every miss before rollout; tune the prompt and re-run if needed.

- [ ] **Step 4: Commit**

```bash
git add script/eval-ap-parser.ts
git commit -m "AP v2: regression eval script (replay historical PDFs vs ground truth)"
git push
```

---

### Task 7: Rollout

**Files:** none (Railway config + verification)

- [ ] **Step 1: User adds `ANTHROPIC_API_KEY` to Railway** service variables (user action — Anthropic Console key). Confirm the deploy picks it up.
- [ ] **Step 2: Verify eval results reviewed and approved by user** (Task 6 Step 3 output).
- [ ] **Step 3: Set `AP_PARSER=claude` on Railway.** Railway redeploys automatically.
- [ ] **Step 4: Watch the next few live supplier emails** (Railway logs `[apDocumentParser]` / `[Webhook]` lines; admin UI rows show `_parser: "claude"` provenance). Confirm: correct docType, store assignment, line items rows in `invoice_line_items`.
- [ ] **Step 5: Rollback plan (if needed):** unset `AP_PARSER` → instant revert to OpenAI path.
- [ ] **Step 6: Update PLAN.md** if the repo has one at root (check; per user convention) — mark AP parser v2 shipped with date.

---

## Self-Review Notes

- Spec §3 (parser) → Task 3; §4 (DB) → Tasks 1-2; §5 (routing/UI) → Tasks 4-5; §6 (eval/rollout) → Tasks 6-7; §7 (errors) → Task 3 Step 2 (null on failure) + Task 4 Step 4 (REVIEW placeholder). §8 exclusions honored (no product matching, no Cowork).
- Type consistency: `ApParseResult`/`ApStoreProfile`/`parseApDocument` names match across Tasks 3, 4, 6; `createInvoiceLineItems(invoiceId, items)` matches Tasks 2 and 4.
- Known adaptation points flagged inline (storage getter name, `stores.address` existence, `db` export path, review-endpoint payload) — executor verifies at the exact file rather than assuming.
