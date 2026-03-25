import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedInvoice {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: number;
  storeCode: "SUSHI" | "SANDWICH" | "UNKNOWN";
}

export interface UploadParsedInvoice {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  storeCode: string;
}

/** Structured supplier details extracted from an invoice by GPT-4o */
export interface ExtractedSupplierInfo {
  supplierName: string;
  supplierAddress: string | null;
  supplierPhone: string | null;
  abn: string | null;
  bsb: string | null;
  accountNumber: string | null;
}

/** A single invoice item extracted from an unknown sender's document */
export interface UnknownSenderInvoiceItem {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: number;
  storeCode: "SUSHI" | "SANDWICH" | "UNKNOWN";
}

/** Combined result for unknown-sender parsing: supplier info + all invoice items */
export interface UnknownSenderParsedResult {
  supplier: ExtractedSupplierInfo;
  invoices: UnknownSenderInvoiceItem[];
}

/**
 * Extract raw text from a PDF buffer using the pdftotext CLI tool.
 * Returns empty string if extraction fails.
 */
export function extractPdfText(buffer: Buffer): string {
  const tmpFile = join(tmpdir(), `invoice_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  try {
    writeFileSync(tmpFile, buffer);
    const result = spawnSync("pdftotext", [tmpFile, "-"], { encoding: "utf-8", timeout: 15000 });
    if (result.error || result.status !== 0) {
      console.warn("[invoiceParser] pdftotext failed:", result.error?.message ?? result.stderr);
      return "";
    }
    return result.stdout ?? "";
  } finally {
    if (existsSync(tmpFile)) {
      try { unlinkSync(tmpFile); } catch { /* ignore cleanup error */ }
    }
  }
}

/**
 * Use OpenAI to extract structured invoice data from raw PDF text.
 * Always returns an ARRAY of invoices:
 *   - Single invoice PDF → array with 1 item
 *   - Statement PDF → array with one item per invoice line listed
 * Returns null if parsing fails completely.
 */
export async function parseInvoiceWithAI(
  rawText: string,
  supplierName: string
): Promise<ParsedInvoice[] | null> {
  const systemPrompt = `You are an invoice data extraction assistant for an Australian retail business.
The text you receive is extracted from a PDF — table layouts may be broken or read vertically.

CRITICAL RULES:
1. You ALWAYS return a JSON ARRAY of invoice objects, never a single object.
2. If the document is a single INVOICE, return an array with exactly 1 item.
3. If the document is a STATEMENT listing multiple invoices, extract EACH individual invoice as a separate array item. DO NOT return the statement's grand total as a single invoice.
4. For storeCode, inspect the "Bill To", "Invoice To", or "Deliver To" name in the document:
   - If it contains "olitin" or "sushime" → storeCode = "SUSHI"
   - If it contains "eatem pty ltd" or "eatem sandwich" → storeCode = "SANDWICH"
   - Otherwise → storeCode = "UNKNOWN"
5. Return ONLY valid JSON with no extra text, code fences, or explanation.`;

  const userPrompt = `Supplier: ${supplierName}

PDF text:
${rawText.slice(0, 8000)}

Extract all invoices and return as a JSON ARRAY. Each item must have:
[
  {
    "invoiceNumber": "string (the invoice or reference number)",
    "issueDate": "YYYY-MM-DD (date the invoice was issued)",
    "dueDate": "YYYY-MM-DD or null (payment due date if present)",
    "totalAmount": number (total amount due as a float, no currency symbols),
    "storeCode": "SUSHI" | "SANDWICH" | "UNKNOWN"
  }
]

If a field cannot be found, use null for optional fields or an empty string for required ones.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 1000,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    const parsed = JSON.parse(cleaned);

    // Accept both array and legacy single-object responses
    const items: any[] = Array.isArray(parsed) ? parsed : [parsed];

    if (items.length === 0) {
      console.warn("[invoiceParser] AI returned empty array");
      return null;
    }

    const results: ParsedInvoice[] = items
      .filter(item => item && (item.invoiceNumber || item.issueDate || item.totalAmount))
      .map(item => ({
        invoiceNumber: String(item.invoiceNumber ?? ""),
        issueDate: String(item.issueDate ?? ""),
        dueDate: item.dueDate ? String(item.dueDate) : null,
        totalAmount: Number(item.totalAmount ?? 0),
        storeCode: (["SUSHI", "SANDWICH", "UNKNOWN"].includes(item.storeCode)
          ? item.storeCode
          : "UNKNOWN") as ParsedInvoice["storeCode"],
      }));

    if (results.length === 0) {
      console.warn("[invoiceParser] AI returned no valid invoice items");
      return null;
    }

    return results;
  } catch (err) {
    console.error("[invoiceParser] AI parsing error:", err);
    return null;
  }
}

const UPLOAD_SYSTEM_PROMPT = `You are an invoice data extraction assistant for an Australian retail/hospitality business.
Extract the key fields from the invoice image or text provided.

CRITICAL RULES:
1. Return ONLY a single JSON object (not an array).
2. For storeCode, look for the "Bill To", "Invoice To", or "Deliver To" name:
   - Contains "olitin" or "sushime" → "SUSHI"
   - Contains "eatem" or "sandwich" → "SANDWICH"
   - Otherwise → "UNKNOWN"
3. Return dates in YYYY-MM-DD format. If a date is unclear, return null.
4. Return amounts as a number (float), no currency symbols.
5. Return ONLY valid JSON with no extra text, code fences, or explanation.

Return this exact structure:
{
  "supplierName": "string (the name of the supplier/company issuing the invoice)",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "amount": number,
  "storeCode": "SUSHI" | "SANDWICH" | "UNKNOWN"
}`;

/**
 * Parse an uploaded invoice file (image or PDF) using GPT-4o.
 * For images: sends as base64 vision input.
 * For PDFs: extracts text then sends as text input.
 * Returns structured invoice data including supplierName.
 */
export async function parseUploadedFile(
  buffer: Buffer,
  mimeType: string
): Promise<UploadParsedInvoice | null> {
  try {
    let messages: OpenAI.ChatCompletionMessageParam[];

    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";

    if (isImage) {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;
      messages = [
        { role: "system", content: UPLOAD_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all invoice fields from this image." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ];
    } else if (isPdf) {
      const rawText = extractPdfText(buffer);
      if (!rawText.trim()) {
        console.warn("[invoiceParser] PDF text extraction returned empty string");
      }
      messages = [
        { role: "system", content: UPLOAD_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract all invoice fields from this PDF text:\n\n${rawText.slice(0, 8000)}`,
        },
      ];
    } else {
      console.warn("[invoiceParser] Unsupported MIME type:", mimeType);
      return null;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0,
      max_tokens: 500,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      supplierName: String(parsed.supplierName ?? ""),
      invoiceNumber: String(parsed.invoiceNumber ?? ""),
      invoiceDate: parsed.invoiceDate ? String(parsed.invoiceDate) : "",
      dueDate: parsed.dueDate ? String(parsed.dueDate) : null,
      amount: Number(parsed.amount ?? 0),
      storeCode: String(parsed.storeCode ?? "UNKNOWN"),
    };
  } catch (err) {
    console.error("[invoiceParser] parseUploadedFile error:", err);
    return null;
  }
}

// ── Email Classification ──────────────────────────────────────────────────────

export interface ClassifiedEmailTask {
  title: string;
  description: string;
  dueDate: string | null; // YYYY-MM-DD
}

export type EmailType = "INVOICE" | "TASK" | "OTHER";

export interface ClassifiedEmail {
  type: EmailType;
  task?: ClassifiedEmailTask;
}

const CLASSIFY_SYSTEM_PROMPT = `You are an AI assistant for an Australian retail/hospitality business.
You receive forwarded emails and must classify them and extract structured data.

CRITICAL RULES:
1. Classify the email into exactly one of: "INVOICE", "TASK", or "OTHER".
   - INVOICE: the email relates to a bill, invoice, statement, purchase order, payment request, or delivery docket from a supplier.
   - TASK: the email contains an action item, reminder, request, question or task that requires follow-up. Examples: "please call X", "can you organise Y", "don't forget to Z".
   - OTHER: newsletters, spam, automated notifications, or anything that is not clearly an invoice or actionable task.
2. If type is "TASK", extract:
   - "title": a concise 5-15 word summary of the task written in KOREAN (imperative form, e.g. "임대 계약 갱신 관련 John에게 전화하기")
   - "description": a 1-3 sentence summary in KOREAN of what needs to be done and any relevant context, translating and summarising the original email content
   - "dueDate": a date in YYYY-MM-DD format if an explicit or strongly implied deadline exists, otherwise null
3. If type is "INVOICE" or "OTHER", the "task" field must be omitted or null.
4. Return ONLY valid JSON with no code fences or explanation.

JSON schema:
{
  "type": "INVOICE" | "TASK" | "OTHER",
  "task": {
    "title": "string (Korean)",
    "description": "string (Korean)",
    "dueDate": "YYYY-MM-DD or null"
  } | null
}`;

/**
 * Classify an incoming email (by subject + body text) using GPT-4o-mini.
 * Returns the email type and, if TASK, the extracted task data.
 * Falls back to "OTHER" on any error.
 */
export async function classifyAndParseEmail(
  subject: string,
  body: string,
): Promise<ClassifiedEmail> {
  const userContent = `Subject: ${subject}

Email body:
${body.slice(0, 4000)}

Classify this email and extract data as instructed.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 400,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    const type: EmailType = (["INVOICE", "TASK", "OTHER"].includes(parsed.type)
      ? parsed.type
      : "OTHER") as EmailType;

    if (type === "TASK" && parsed.task) {
      return {
        type,
        task: {
          title: String(parsed.task.title ?? "Untitled Task"),
          description: String(parsed.task.description ?? ""),
          dueDate: parsed.task.dueDate ? String(parsed.task.dueDate) : null,
        },
      };
    }

    return { type };
  } catch (err) {
    console.error("[invoiceParser] classifyAndParseEmail error:", err);
    return { type: "OTHER" };
  }
}

const UNKNOWN_SENDER_SYSTEM_PROMPT = `You are an invoice data extraction assistant for an Australian retail/hospitality business.
An email with a PDF invoice/statement has arrived from an UNKNOWN sender. Extract everything you can.

CRITICAL RULES:
1. Return ONLY a single JSON object (no arrays at top level, no code fences, no explanation).
2. Extract the SUPPLIER (the company issuing the invoice) — not the customer/recipient.
3. For storeCode per invoice, look at the "Bill To" / "Invoice To" / "Deliver To" name:
   - Contains "olitin" or "sushime" → "SUSHI"
   - Contains "eatem" or "sandwich" → "SANDWICH"
   - Otherwise → "UNKNOWN"
4. Dates must be in YYYY-MM-DD format. Use null if unclear.
5. Amounts must be numbers (float, no currency symbols).
6. The document may be a STATEMENT with multiple invoice line items — extract ALL of them.
7. If a field is not visible or cannot be determined, use null.

Return this exact structure:
{
  "supplier": {
    "supplierName": "string",
    "supplierAddress": "string or null",
    "supplierPhone": "string or null",
    "abn": "string or null (Australian Business Number, digits only or formatted)",
    "bsb": "string or null (bank BSB, e.g. 062-000)",
    "accountNumber": "string or null"
  },
  "invoices": [
    {
      "invoiceNumber": "string",
      "issueDate": "YYYY-MM-DD or null",
      "dueDate": "YYYY-MM-DD or null",
      "totalAmount": number,
      "storeCode": "SUSHI" | "SANDWICH" | "UNKNOWN"
    }
  ]
}`;

/**
 * Parse an invoice PDF from an unknown sender.
 * Extracts comprehensive supplier info AND all invoice line items.
 * Used in the Auto-Discovery Review Inbox workflow.
 */
export async function parseInvoiceFromUnknownSender(
  pdfText: string
): Promise<UnknownSenderParsedResult | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: UNKNOWN_SENDER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract all fields from this invoice/statement:\n\n${pdfText.slice(0, 12000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    const supplierRaw = parsed.supplier ?? {};
    const supplier: ExtractedSupplierInfo = {
      supplierName: String(supplierRaw.supplierName ?? "Unknown Supplier"),
      supplierAddress: supplierRaw.supplierAddress ? String(supplierRaw.supplierAddress) : null,
      supplierPhone: supplierRaw.supplierPhone ? String(supplierRaw.supplierPhone) : null,
      abn: supplierRaw.abn ? String(supplierRaw.abn) : null,
      bsb: supplierRaw.bsb ? String(supplierRaw.bsb) : null,
      accountNumber: supplierRaw.accountNumber ? String(supplierRaw.accountNumber) : null,
    };

    const invoicesRaw = Array.isArray(parsed.invoices) ? parsed.invoices : [];
    const invoices: UnknownSenderInvoiceItem[] = invoicesRaw
      .filter((item: any) => item && (item.invoiceNumber || item.totalAmount))
      .map((item: any) => ({
        invoiceNumber: String(item.invoiceNumber ?? ""),
        issueDate: item.issueDate ? String(item.issueDate) : new Date().toISOString().split("T")[0],
        dueDate: item.dueDate ? String(item.dueDate) : null,
        totalAmount: Number(item.totalAmount ?? 0),
        storeCode: (["SUSHI", "SANDWICH", "UNKNOWN"].includes(item.storeCode)
          ? item.storeCode
          : "UNKNOWN") as UnknownSenderInvoiceItem["storeCode"],
      }));

    if (invoices.length === 0) {
      console.warn("[invoiceParser] parseInvoiceFromUnknownSender: no invoice items extracted");
    }

    return { supplier, invoices };
  } catch (err) {
    console.error("[invoiceParser] parseInvoiceFromUnknownSender error:", err);
    return null;
  }
}
