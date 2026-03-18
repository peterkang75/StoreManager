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
 * Returns null if parsing fails or the AI cannot identify required fields.
 */
export async function parseInvoiceWithAI(
  rawText: string,
  supplierName: string
): Promise<ParsedInvoice | null> {
  const systemPrompt = `You are an invoice data extraction assistant. 
The text you receive is extracted from a PDF — table layouts may be broken or read vertically. 
Extract the invoice details and return ONLY a valid JSON object with no extra text, code fences, or explanation.`;

  const userPrompt = `Supplier: ${supplierName}

PDF text:
${rawText.slice(0, 6000)}

Extract the following fields and return as JSON:
{
  "invoiceNumber": "string (the invoice or reference number)",
  "issueDate": "YYYY-MM-DD (date the invoice was issued)",
  "dueDate": "YYYY-MM-DD or null (payment due date if present)",
  "totalAmount": number (the total amount due, as a float, no currency symbols)
}

If a field cannot be found, use null for optional fields or an empty string for required ones.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    const parsed = JSON.parse(cleaned) as ParsedInvoice;

    // Basic sanity check
    if (!parsed.invoiceNumber && !parsed.issueDate && !parsed.totalAmount) {
      console.warn("[invoiceParser] AI returned empty/invalid fields");
      return null;
    }

    return {
      invoiceNumber: String(parsed.invoiceNumber ?? ""),
      issueDate: String(parsed.issueDate ?? ""),
      dueDate: parsed.dueDate ? String(parsed.dueDate) : null,
      totalAmount: Number(parsed.totalAmount ?? 0),
    };
  } catch (err) {
    console.error("[invoiceParser] AI parsing error:", err);
    return null;
  }
}
