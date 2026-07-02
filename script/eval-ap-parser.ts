// Replays historical invoice PDFs (rawExtractedData.pdfBase64) through the new
// Claude parser and compares against the human-corrected DB values.
// READ-ONLY. Usage:
//   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx script/eval-ap-parser.ts [limit]
import { db, pool } from "../server/db";
import { supplierInvoices, suppliers, stores } from "../shared/schema";
import { inArray, eq } from "drizzle-orm";
import { parseApDocument, type ApStoreProfile } from "../server/apDocumentParser";

async function main() {
  const limit = parseInt(process.argv[2] ?? "30", 10);
  const allStores = await db.select().from(stores);
  const storeProfiles: ApStoreProfile[] = allStores
    .filter((s) => s.active && !s.isExternal)
    .map((s) => ({
      name: s.name,
      address: s.address ?? null,
      aliases: (s.bodyAliases ?? []).filter((a): a is string => a != null),
    }));
  const storeNameById = new Map(allStores.map((s) => [s.id, s.name]));

  const rows = await db.select().from(supplierInvoices)
    .where(inArray(supplierInvoices.status, ["PENDING", "PAID"])); // human-verified ground truth
  const withPdf = rows.filter((r) => (r.rawExtractedData as any)?.pdfBase64).slice(0, limit);
  console.log(`Evaluating ${withPdf.length} historical invoices (of ${rows.length} candidates)...`);

  let storeHit = 0, storeMiss = 0, storeUnknown = 0;
  let amountHit = 0, amountMiss = 0;
  let numHit = 0, numMiss = 0;
  let statementFlags = 0, failures = 0;

  for (const row of withPdf) {
    const raw = row.rawExtractedData as any;
    const sup = row.supplierId
      ? (await db.select().from(suppliers).where(eq(suppliers.id, row.supplierId)))[0]
      : null;
    const result = await parseApDocument({
      fileBase64: raw.pdfBase64,
      mediaType: "application/pdf",
      supplierHint: sup?.name ?? "",
      supplierIsMultiStore: sup?.isMultiStore ?? false,
      subject: raw.subject ?? "",
      storeProfiles,
    });
    if (!result) {
      failures++;
      console.log(`✗ ${row.invoiceNumber}: PARSE FAILED`);
      continue;
    }

    const truthStore = row.storeId ? (storeNameById.get(row.storeId) ?? "?") : null;
    const gotStore = result.confidence.store >= 0.7 ? result.store : "UNKNOWN";
    if (truthStore) {
      if (gotStore === truthStore) storeHit++;
      else if (gotStore === "UNKNOWN") storeUnknown++;
      else {
        storeMiss++;
        console.log(`✗ STORE ${row.invoiceNumber}: expected ${truthStore}, got ${gotStore} — "${result.reasoning}"`);
      }
    }

    const gotInv = result.invoices.find((i) => i.invoiceNumber === row.invoiceNumber) ?? result.invoices[0];
    if (gotInv && Math.abs(gotInv.totalAmount - row.amount) < 0.01) {
      amountHit++;
    } else {
      amountMiss++;
      console.log(`✗ AMOUNT ${row.invoiceNumber}: expected ${row.amount}, got ${gotInv?.totalAmount ?? "-"}`);
    }

    if (gotInv && gotInv.invoiceNumber === row.invoiceNumber) numHit++; else numMiss++;
    if (result.docType === "STATEMENT") statementFlags++;
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Store:   ${storeHit} hit / ${storeMiss} WRONG / ${storeUnknown} unknown(safe)`);
  console.log(`Amount:  ${amountHit} hit / ${amountMiss} miss`);
  console.log(`Inv#:    ${numHit} hit / ${numMiss} miss`);
  console.log(`Statements flagged: ${statementFlags}, hard failures: ${failures}`);
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  pool.end().finally(() => process.exit(1));
});
