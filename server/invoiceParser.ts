import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedInvoice {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: number;
  storeCode: "SUSHI" | "SANDWICH" | "UNKNOWN";
  /** Supplier/vendor company name as it appears on the PDF itself (not the hint passed in).
   *  For aggregator-platform invoices (Ordermentum, Fresho…), this is the real underlying
   *  supplier extracted from the "From:" / "Vendor:" section — NOT the platform name. */
  extractedSupplierName?: string;
  /** ABN of the real supplier, if found in the PDF (e.g. "12 345 678 901") */
  abn?: string | null;
  /** Raw delivery/ship-to/bill-to address or store name from the PDF — used for fuzzy store matching */
  deliveryLocation?: string | null;
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
  supplierEmail: string | null;
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
 * Extract raw text from a PDF buffer using pdf-parse v2 (pure JS, no system deps).
 * pdf-parse v2 uses a class-based API: new PDFParse({ data: buffer }).getText()
 * Returns empty string if extraction fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse") as {
      PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> };
    };
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text ?? "";
  } catch (err) {
    console.warn("[invoiceParser] pdf-parse failed:", err);
    return "";
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
3. If the document is a STATEMENT listing multiple invoices, extract EACH individual invoice as a separate array item — including future-dated invoices and those with partial payments. DO NOT return the statement's grand total as a single invoice. Do NOT skip rows with future due dates or $0 balance.
4. For storeCode, inspect the "Bill To", "Invoice To", "Deliver To", or "Attention" name in the document:
   - If it contains "olitin", "sushim", "sushme", or "kogarah" → storeCode = "SUSHI"
   - If it contains "eatem pty ltd" or "eatem sandwich" → storeCode = "SANDWICH"
   - Otherwise → storeCode = "UNKNOWN"
5. For deliveryLocation, copy the EXACT text of the "Delivery Address", "Ship To", "Deliver To", "Bill To", or "Attention" field as it appears on the document. This is the raw address of the receiving store. Return null if not found.
6. Return ONLY valid JSON with no extra text, code fences, or explanation.

WARNING — AGGREGATOR / MARKETPLACE PLATFORMS:
Some invoices are generated and delivered by a marketplace or ordering platform (e.g. "Ordermentum", "Fresho", "MarketPlacer", or similar). In these cases the platform name appears prominently at the top of the PDF and in the email sender — but the platform is NOT the supplier. It is merely a delivery channel.
You MUST identify the REAL underlying supplier — the business that actually produced or delivered the goods — by searching the PDF text for sections such as:
  • "From:" or "From" block (typically near the top of the invoice body)
  • "Vendor:" or "Vendor Details:"
  • "Supplier:" or "Supplier Details:"
  • "Sold by:" or "Issued by:"
  • Any block containing an ABN (Australian Business Number) that belongs to the vendor, NOT the platform
Extract the business name and ABN from this "From / Vendor / Supplier" section and use it as extractedSupplierName. Ignore the platform name entirely for supplier identification. The PDF body ALWAYS overrides the email sender and the hint.`;

  const userPrompt = `Supplier hint (from email routing — may be WRONG if the email was forwarded OR if the email was sent via an aggregator platform like Ordermentum/Fresho): ${supplierName}

IMPORTANT — PDF CONTENT TAKES ABSOLUTE PRIORITY:
The PDF text below is the ground truth. The supplier hint above is only a fallback. If the PDF clearly identifies a real supplier (via a "From:", "Vendor:", "Supplier Details:", or ABN block), use that name — even if it completely contradicts the hint.

PDF text:
${rawText.slice(0, 8000)}

Extract all invoices and return as a JSON ARRAY. Each item must have:
[
  {
    "extractedSupplierName": "string (the ACTUAL underlying supplier/vendor as found inside the PDF body — NOT the platform name like Ordermentum or Fresho, NOT the hint above)",
    "abn": "string or null (ABN of the real supplier if found in the PDF, e.g. '12 345 678 901')",
    "invoiceNumber": "string (the invoice or reference number)",
    "issueDate": "YYYY-MM-DD (date the invoice was issued)",
    "dueDate": "YYYY-MM-DD or null (payment due date if present)",
    "totalAmount": number (total amount due as a float, no currency symbols),
    "storeCode": "SUSHI" | "SANDWICH" | "UNKNOWN",
    "deliveryLocation": "string or null (exact text of the Delivery/Ship To/Bill To/Attention field — the receiving store's address or name)"
  }
]

REMINDER: If the invoice was sent via an aggregator platform (Ordermentum, Fresho, etc.), the real supplier is in the "From:" or "Vendor:" section of the PDF — return THAT name, not the platform name.
If a field cannot be found, use null for optional fields or an empty string for required ones.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 3000,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    // Strip any accidental markdown code fences
    let cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    // If the JSON was truncated (unterminated), try to recover the partial array
    // by closing any open objects and the array
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Attempt to salvage a truncated JSON array by closing it properly
      // Find the last complete object (ending with }) and close the array
      const lastCompleteObj = cleaned.lastIndexOf("}");
      if (lastCompleteObj !== -1) {
        const truncated = cleaned.slice(0, lastCompleteObj + 1);
        // Find the start of the array to close it
        const arrayStart = truncated.indexOf("[");
        if (arrayStart !== -1) {
          try {
            parsed = JSON.parse(truncated.slice(arrayStart) + "]");
            console.warn("[invoiceParser] Recovered truncated JSON array with", Array.isArray(parsed) ? parsed.length : 0, "items");
          } catch {
            // Still failed — re-throw original error
            throw new SyntaxError("Unterminated JSON could not be recovered");
          }
        } else {
          throw new SyntaxError("Unterminated JSON could not be recovered");
        }
      } else {
        throw new SyntaxError("Unterminated JSON could not be recovered");
      }
    }

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
        extractedSupplierName: item.extractedSupplierName ? String(item.extractedSupplierName).trim() : undefined,
        abn: item.abn ? String(item.abn).trim() : null,
        deliveryLocation: item.deliveryLocation ? String(item.deliveryLocation).trim() : null,
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
      const rawText = await extractPdfText(buffer);
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

// ── Step 1: Strict Email Triage (The Gatekeeper) ─────────────────────────────

/**
 * Step 1 of the two-step pipeline.
 * Uses GPT-4o to classify the email into EXACTLY one category.
 * Does NOT attempt extraction — purely a routing decision.
 *
 * INVOICE: Any email where money is owed to a supplier (invoices, bills,
 *          statements, fuel levies, charges, surcharges, etc.)
 * TASK:    Any email requiring a human action that is NOT a supplier payment.
 * JUNK:    Marketing, spam, newsletters, automated notifications.
 */
export type TriageResult = "INVOICE" | "TASK" | "JUNK";

const TRIAGE_SYSTEM_PROMPT = `You are a strict email triage system for an Australian retail/hospitality business.
Your ONLY job is to classify the email. Reply with EXACTLY ONE WORD — nothing else.

INVOICE — The email is, or contains, a financial document where money is owed to a supplier.
  This includes: invoices, bills, statements, purchase orders, delivery dockets,
  fuel levies, fuel surcharges, freight charges, service fees, handling fees,
  admin fees, credit notes, subscription charges, rent invoices, utility bills,
  insurance renewals, or any email that implies a charge from a business to another.
  When in doubt between INVOICE and anything else, choose INVOICE.

TASK — The email requires a human action or follow-up that is NOT paying a supplier.
  Examples: "please call X", "can you organise Y", "reminder to submit Z",
  "don't forget to do W", internal requests, questions needing a reply.

JUNK — Marketing, newsletters, promotions, spam, automated system alerts with no
  action required, or anything completely irrelevant to the business.

Reply with ONLY the single word: INVOICE, TASK, or JUNK`;

export async function triageEmail(
  subject: string,
  body: string,
  hasAttachment: boolean,
): Promise<TriageResult> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: TRIAGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Subject: ${subject}
Has attachment: ${hasAttachment}

Body:
${body.slice(0, 3000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 5,
    });

    const raw = (response.choices[0]?.message?.content ?? "").trim().toUpperCase();
    if (raw === "INVOICE" || raw === "TASK" || raw === "JUNK") return raw;
    console.warn(`[invoiceParser] triageEmail unexpected result: "${raw}" — defaulting to JUNK`);
    return "JUNK";
  } catch (err) {
    console.error("[invoiceParser] triageEmail error:", err);
    return "JUNK";
  }
}

// ── Step 2B: Task Summarization (TASK branch only) ────────────────────────────

/**
 * Step 2 of the TASK branch.
 * Extracts a structured task summary in Korean from the email content.
 * Called ONLY after triageEmail returns "TASK".
 */
export interface TaskSummary {
  title: string;
  description: string;
  dueDate: string | null;
}

const TASK_SUMMARY_SYSTEM_PROMPT = `You are a task extraction assistant for an Australian retail/hospitality business.
Read the email and extract the action item. Write your response in KOREAN.

Return ONLY valid JSON with no code fences or explanation:
{
  "title": "5-15 word imperative task title in Korean (e.g. '임대 계약 갱신 관련 John에게 전화하기')",
  "description": "1-3 sentence Korean summary of what needs to be done and any relevant context",
  "dueDate": "YYYY-MM-DD if there is an explicit or strongly implied deadline, otherwise null"
}`;

export async function summarizeTaskFromEmail(
  subject: string,
  body: string,
): Promise<TaskSummary | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TASK_SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Subject: ${subject}

Body:
${body.slice(0, 4000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 300,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      title: String(parsed.title ?? subject ?? "Untitled Task"),
      description: String(parsed.description ?? ""),
      dueDate: parsed.dueDate ? String(parsed.dueDate) : null,
    };
  } catch (err) {
    console.error("[invoiceParser] summarizeTaskFromEmail error:", err);
    return null;
  }
}

const UNKNOWN_SENDER_SYSTEM_PROMPT = `You are an invoice data extraction assistant for an Australian retail/hospitality business.
An email with a PDF invoice/statement has arrived from an UNKNOWN sender. Extract everything you can.

CRITICAL RULES:
1. Return ONLY a single JSON object (no arrays at top level, no code fences, no explanation).
2. Extract the SUPPLIER (the company issuing the invoice) — not the customer/recipient.
3. For storeCode per invoice, look at the "Bill To" / "Invoice To" / "Deliver To" / "Attention" name:
   - Contains "olitin", "sushim", "sushme", or "kogarah" → "SUSHI"
   - Contains "eatem" or "sandwich" → "SANDWICH"
   - Otherwise → "UNKNOWN"
4. Dates must be in YYYY-MM-DD format. Use null if unclear.
5. Amounts must be numbers (float, no currency symbols).
6. The document may be a STATEMENT listing multiple invoices — you MUST extract EVERY SINGLE ROW from the table, including:
   - Future-dated invoices (due date after the statement date)
   - Invoices with $0 payment made
   - Invoices with partial payments already made
   - ALL rows regardless of balance, due date, or payment status
   Do NOT stop after overdue items. Do NOT skip rows with future due dates.
7. If a field is not visible or cannot be determined, use null.

Return this exact structure:
{
  "supplier": {
    "supplierName": "string",
    "supplierEmail": "string or null — ONLY include if the supplier's own email address is explicitly printed in the document body (e.g. on the invoice header or footer). Return null if no email is visible. NEVER use or guess an email from the To/From email headers; those may belong to a forwarding service, not the supplier.",
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
          content: `Extract ALL fields from this invoice/statement. If it is a STATEMENT, count every row in the table and return an invoice entry for EACH row — do not skip any rows with future due dates or zero balances:\n\n${pdfText.slice(0, 16000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 4000,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    let cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    // Recover truncated JSON: close the invoices array and the root object if needed
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const lastObj = cleaned.lastIndexOf("}");
      if (lastObj !== -1) {
        let attempt = cleaned.slice(0, lastObj + 1);
        // Count unclosed brackets to determine what needs closing
        const opens = (attempt.match(/\[/g) || []).length;
        const closes = (attempt.match(/\]/g) || []).length;
        const objOpens = (attempt.match(/\{/g) || []).length;
        const objCloses = (attempt.match(/\}/g) || []).length;
        if (opens > closes) attempt += "]";
        if (objOpens > objCloses) attempt += "}";
        try {
          parsed = JSON.parse(attempt);
          console.warn("[invoiceParser] parseInvoiceFromUnknownSender: recovered truncated JSON");
        } catch {
          throw new SyntaxError("Unterminated JSON in unknown-sender response could not be recovered");
        }
      } else {
        throw new SyntaxError("Unterminated JSON in unknown-sender response could not be recovered");
      }
    }

    const supplierRaw = parsed.supplier ?? {};
    const supplier: ExtractedSupplierInfo = {
      supplierName: String(supplierRaw.supplierName ?? "Unknown Supplier"),
      supplierEmail: supplierRaw.supplierEmail ? String(supplierRaw.supplierEmail) : null,
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

/**
 * Fast AI micro-classifier: determines if a document is a payment request
 * (INVOICE) or a non-payable document (CONFIRMATION/receipt/order confirmation).
 * Uses gpt-4o-mini for speed and low cost.
 * Fails SAFE: returns "INVOICE" on any error so we never accidentally discard a real invoice.
 */
export async function classifyDocumentForAP(
  text: string
): Promise<"INVOICE" | "CONFIRMATION"> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a strict document classifier for an accounts payable system. " +
            "Reply with exactly one word: INVOICE or CONFIRMATION. No punctuation, no explanation.",
        },
        {
          role: "user",
          content:
            "Classify this document:\n" +
            "- INVOICE: A bill or invoice that requests payment. Has an amount due, " +
            "invoice number, and/or payment terms. The business must pay this.\n" +
            "- CONFIRMATION: An order confirmation, delivery receipt, dispatch notice, " +
            "order acknowledgement, or any document where no payment is currently due.\n\n" +
            `Document (first 3000 chars):\n${text.slice(0, 3000)}\n\n` +
            "Reply ONLY with INVOICE or CONFIRMATION.",
        },
      ],
      max_tokens: 5,
      temperature: 0,
    });

    const result = response.choices[0]?.message?.content?.trim().toUpperCase();
    if (result === "INVOICE" || result === "CONFIRMATION") {
      console.log(`[classifyDocumentForAP] Result: ${result}`);
      return result;
    }
    console.warn(`[classifyDocumentForAP] Unexpected response "${result}", defaulting to INVOICE`);
    return "INVOICE";
  } catch (err) {
    console.warn("[classifyDocumentForAP] AI call failed, defaulting to INVOICE (fail-safe):", err);
    return "INVOICE";
  }
}
