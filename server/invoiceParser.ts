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
