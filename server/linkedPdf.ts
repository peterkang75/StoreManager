// Some suppliers email a download link instead of attaching the invoice
// (Total Equipment: "…/paytrack/…_Equipment_Monthly_Rental_Service_21.pdf").
// Fetch such PDFs so they go through the normal attachment pipeline.
// Callers only pass bodies from whitelisted supplier senders; this still refuses
// anything that isn't a public https URL returning a real PDF of sane size.
const MAX_BYTES = 10 * 1024 * 1024;
const PDF_LINK = /https:\/\/[^\s"'<>()]+?\.pdf(?=[\s"'<>()?#]|$)/gi;

function isPublicHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (/^[\d.]+$/.test(h) || h.includes(":")) return false; // IP literals (v4/v6) — no internal targets
    if (h === "localhost" || /\.(local|internal|lan|home|corp)$/.test(h) || !h.includes(".")) return false;
    return true;
  } catch { return false; }
}

export function findPdfLinks(body: string | null | undefined, max = 3): string[] {
  return Array.from(new Set((body ?? "").match(PDF_LINK) ?? [])).filter(isPublicHttps).slice(0, max);
}

/** Download one linked PDF; null on any doubt (timeout, too big, not a PDF, redirect off public https). */
export async function fetchLinkedPdf(url: string): Promise<{ file_name: string; content_type: string; content: string } | null> {
  if (!isPublicHttps(url)) return null;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !isPublicHttps(res.url || url)) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    const file_name = decodeURIComponent(new URL(res.url || url).pathname.split("/").pop() || "linked.pdf");
    return { file_name, content_type: "application/pdf", content: buf.toString("base64") };
  } catch {
    return null;
  }
}

export async function fetchLinkedPdfs(body: string | null | undefined) {
  const out = [];
  for (const url of findPdfLinks(body)) {
    const att = await fetchLinkedPdf(url);
    if (att) out.push(att);
    else console.warn(`[linkedPdf] could not use ${url}`);
  }
  return out;
}

/**
 * Records created from a body that only linked to the PDF (no document kept):
 * re-fetch the link from the stored body, attach the PDF, and set the store from
 * the PDF ("Bill To") via store aliases when the record has none. A PDF is used
 * only if the recorded amount is printed on it. apply=false only reads.
 */
export async function backfillLinkedPdfs(
  apply: boolean,
  deps: {
    db: any; sql: any;
    extractText: (b: Buffer) => Promise<string>;
    resolveStore: (text: string) => string | null;
    storeName: (id: string) => string | null;
    update: (id: string, patch: any) => Promise<unknown>;
  },
) {
  const { db, sql } = deps;
  const res = await db.execute(sql`
    SELECT i.id, s.name AS supplier, i.invoice_number, i.amount, i.status, i.store_id, i.raw_extracted_data AS raw
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.status <> 'DELETED' AND coalesce(length(i.raw_extracted_data->>'pdfBase64'), 0) < 100
      AND i.raw_extracted_data->>'body' ~* 'https://[^[:space:]]+\\.pdf'`);
  const rows: any[] = [];
  for (const r of res.rows as any[]) {
    const base = { id: r.id, supplier: r.supplier, invoiceNumber: r.invoice_number, amount: Number(r.amount), status: r.status };
    const att = (await Promise.all(findPdfLinks(r.raw?.body).map(fetchLinkedPdf))).find(Boolean);
    if (!att) { rows.push({ ...base, action: "link_unavailable" }); continue; }
    const text = await deps.extractText(Buffer.from(att.content, "base64"));
    const amt = Number(r.amount).toFixed(2);
    if (!text.includes(amt) && !text.includes(Number(r.amount).toLocaleString("en-AU", { minimumFractionDigits: 2 }))) {
      rows.push({ ...base, action: "amount_not_on_pdf" }); continue;
    }
    const storeId = r.store_id ? null : deps.resolveStore(text);
    if (apply) {
      await deps.update(r.id, {
        rawExtractedData: { ...r.raw, pdfBase64: att.content, _originalSource: `linked-pdf:${att.file_name}`, _originalAttachedAt: new Date().toISOString() },
        ...(storeId ? { storeId } : {}),
      });
    }
    rows.push({ ...base, action: "attach", fileName: att.file_name, store: storeId ? deps.storeName(storeId) : null, hadStore: !!r.store_id });
  }
  return { apply, rows };
}
