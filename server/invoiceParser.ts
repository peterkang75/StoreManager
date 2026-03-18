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
