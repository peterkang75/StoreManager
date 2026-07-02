import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

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
        source: { type: "base64", media_type: input.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: input.fileBase64 },
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
