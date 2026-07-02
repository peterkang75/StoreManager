// Replays historical invoice PDFs (rawExtractedData.pdfBase64) through the new
// Claude parser and compares against the human-corrected DB values.
// READ-ONLY. Usage:
//   DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx script/eval-ap-parser.ts [limit]
//
// Deduplication: each unique PDF (by MD5 of pdfBase64) is evaluated ONCE.
// Ground truth: all DB rows sharing that PDF hash.
// Sampling: round-robin across suppliers so no single supplier dominates.
import { createHash } from "crypto";
import { db, pool } from "../server/db";
import { supplierInvoices, suppliers, stores } from "../shared/schema";
import { inArray } from "drizzle-orm";
import { parseApDocument, type ApStoreProfile } from "../server/apDocumentParser";

async function main() {
  const limit = parseInt(process.argv[2] ?? "30", 10);

  // --- Fetch reference data once (hoisted out of the per-PDF loop) ---
  const allStores = await db.select().from(stores);
  const storeProfiles: ApStoreProfile[] = allStores
    .filter((s) => s.active && !s.isExternal)
    .map((s) => ({
      name: s.name,
      address: s.address ?? null,
      aliases: (s.bodyAliases ?? []).filter((a): a is string => a != null),
    }));
  const storeNameById = new Map(allStores.map((s) => [s.id, s.name]));

  // Hoist all supplier lookups into a Map — no per-PDF DB queries
  const allSuppliers = await db.select().from(suppliers);
  const supplierById = new Map(allSuppliers.map((s) => [s.id, s]));

  // --- Load all human-verified rows ---
  const rows = await db.select().from(supplierInvoices)
    .where(inArray(supplierInvoices.status, ["PENDING", "PAID"]));

  const withPdf = rows.filter((r) => (r.rawExtractedData as any)?.pdfBase64);
  const withoutPdf = rows.filter((r) => !(r.rawExtractedData as any)?.pdfBase64);

  // --- Dedupe by MD5 of pdfBase64 ---
  type InvoiceRow = typeof rows[number];
  const byHash = new Map<string, InvoiceRow[]>();
  for (const row of withPdf) {
    const hash = createHash("md5")
      .update((row.rawExtractedData as any).pdfBase64 as string)
      .digest("hex");
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash)!.push(row);
  }

  // --- Exclusion counts ---
  const nullStoreRows = withPdf.filter((r) => r.storeId == null).length;
  console.log(`Total candidate rows: ${rows.length}`);
  console.log(`  Rows with PDF: ${withPdf.length}`);
  console.log(`  Rows without PDF (excluded from eval): ${withoutPdf.length}`);
  console.log(`  Rows with null storeId (excluded from store scoring): ${nullStoreRows}`);
  console.log(`  Unique PDFs (by MD5): ${byHash.size}`);

  // --- Round-robin spread by supplier ---
  // Group unique hashes by the first row's supplierId
  const bySupplier = new Map<string, string[]>();
  for (const [hash, hashRows] of byHash) {
    const key = hashRows[0].supplierId ?? "__null__";
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(hash);
  }
  console.log(`  Suppliers represented: ${bySupplier.size}`);

  // Round-robin: take one hash from each supplier queue per round
  const supplierQueues = [...bySupplier.values()].map((h) => [...h]);
  const orderedHashes: string[] = [];
  while (true) {
    let addedThisRound = false;
    for (const queue of supplierQueues) {
      if (queue.length > 0) {
        orderedHashes.push(queue.shift()!);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
  }

  const selectedHashes = orderedHashes.slice(0, limit);
  const totalGroundTruthRows = selectedHashes.reduce(
    (sum, hash) => sum + byHash.get(hash)!.length,
    0,
  );

  console.log(
    `\nEvaluating ${selectedHashes.length} unique PDFs (limit=${limit}, ` +
    `covering ${totalGroundTruthRows} ground-truth rows)...\n`,
  );

  if (selectedHashes.length === 0) {
    console.log("No PDFs to evaluate (limit=0 or no PDFs with hash found). Exiting.");
    await pool.end();
    return;
  }

  // --- Scoring counters ---
  let storeHit = 0, storeMiss = 0, storeUnknown = 0, storeSkipped = 0;
  let amountHit = 0, amountMissOnMatched = 0;
  let numHit = 0, numMiss = 0;
  let statementFlags = 0, failures = 0;

  const storeSkipLog: string[] = [];

  for (const hash of selectedHashes) {
    const gtRows = byHash.get(hash)!;
    const firstRow = gtRows[0];
    const raw = firstRow.rawExtractedData as any;
    const sup = firstRow.supplierId
      ? (supplierById.get(firstRow.supplierId) ?? null)
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
      const invNums = gtRows.map((r) => r.invoiceNumber).join(", ");
      console.log(`✗ PARSE FAILED — invoices on this PDF: ${invNums}`);
      numMiss += gtRows.length;
      // amount misses: counted implicitly via numMiss; don't double-add to amountMiss
      continue;
    }

    if (result.docType === "STATEMENT") statementFlags++;

    // --- Per-row: exact invoiceNumber match, no ?? fallback ---
    for (const gtRow of gtRows) {
      const matched = result.invoices.find(
        (i) => i.invoiceNumber === gtRow.invoiceNumber,
      );
      if (matched) {
        numHit++;
        if (Math.abs(matched.totalAmount - gtRow.amount) < 0.01) {
          amountHit++;
        } else {
          amountMissOnMatched++;
          console.log(
            `✗ AMOUNT ${gtRow.invoiceNumber}: expected ${gtRow.amount}, ` +
            `got ${matched.totalAmount}`,
          );
        }
      } else {
        numMiss++;
        const returnedNums =
          result.invoices.map((i) => i.invoiceNumber).join(", ") || "(none)";
        console.log(
          `✗ INV# ${gtRow.invoiceNumber}: not found in parser output ` +
          `[parser returned: ${returnedNums}]`,
        );
      }
    }

    // --- PDF-level store scoring ---
    // All ground-truth rows for this PDF must agree on storeId
    const uniqueStoreIds = [...new Set(gtRows.map((r) => r.storeId))];
    if (uniqueStoreIds.length > 1) {
      storeSkipped++;
      const reason =
        `PDF (inv: ${gtRows.map((r) => r.invoiceNumber).join(", ")}) ` +
        `has ${uniqueStoreIds.length} different storeIds — disagreement, skipped`;
      storeSkipLog.push(reason);
      console.log(`  STORE SKIP (disagreement): ${reason}`);
    } else if (uniqueStoreIds[0] == null) {
      storeSkipped++;
      storeSkipLog.push(
        `PDF (inv: ${gtRows.map((r) => r.invoiceNumber).join(", ")}) storeId is null`,
      );
    } else {
      const truthStore = storeNameById.get(uniqueStoreIds[0]) ?? "?";
      const gotStore =
        result.confidence.store >= 0.7 ? result.store : "UNKNOWN";
      if (gotStore === truthStore) {
        storeHit++;
      } else if (gotStore === "UNKNOWN") {
        storeUnknown++;
      } else {
        storeMiss++;
        console.log(
          `✗ STORE (${gtRows.map((r) => r.invoiceNumber).join(", ")}): ` +
          `expected ${truthStore}, got ${gotStore} — "${result.reasoning}"`,
        );
      }
    }
  }

  // --- Results ---
  const rowMatchRate =
    totalGroundTruthRows > 0
      ? ((numHit / totalGroundTruthRows) * 100).toFixed(1)
      : "N/A";
  // Amount hit rate over matched rows only (per spec)
  const amountRateOverMatched =
    numHit > 0
      ? ((amountHit / numHit) * 100).toFixed(1)
      : "N/A";
  // Strict overall: unmatched rows also count as amount miss
  const totalAmountMiss = amountMissOnMatched + numMiss;
  const amountRateAll =
    totalGroundTruthRows > 0
      ? ((amountHit / totalGroundTruthRows) * 100).toFixed(1)
      : "N/A";

  console.log(`\n=== RESULTS ===`);
  console.log(`Unique PDFs evaluated:      ${selectedHashes.length}`);
  console.log(`Ground-truth rows covered:  ${totalGroundTruthRows}`);
  console.log(``);
  console.log(
    `Store (per PDF):  ${storeHit} hit / ${storeMiss} WRONG / ` +
    `${storeUnknown} unknown(safe) / ${storeSkipped} skipped`,
  );
  if (storeSkipLog.length > 0) {
    console.log(`  Skipped reasons:`);
    storeSkipLog.forEach((r) => console.log(`    - ${r}`));
  }
  console.log(`Inv#  (per row):  ${numHit} hit / ${numMiss} miss  →  row-match rate: ${rowMatchRate}%`);
  console.log(
    `Amount (over matched rows):  ${amountHit} hit / ${amountMissOnMatched} miss ` +
    `→  ${amountRateOverMatched}%  (success bar: ≥90%)`,
  );
  console.log(
    `Amount (strict, all rows):   ${amountHit} hit / ${totalAmountMiss} miss ` +
    `→  ${amountRateAll}%`,
  );
  console.log(`Statements flagged: ${statementFlags}, hard failures: ${failures}`);

  console.log(`\n=== SUCCESS BARS ===`);
  console.log(`  WRONG stores:    ${storeMiss}  (required: 0)  ${storeMiss === 0 ? "PASS" : "FAIL"}`);
  console.log(
    `  Amount hit rate: ${amountRateOverMatched}%  (required: ≥90%)  ` +
    `${parseFloat(amountRateOverMatched) >= 90 ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  Row-match rate:  ${rowMatchRate}%  (required: ≥90%)  ` +
    `${parseFloat(rowMatchRate) >= 90 ? "PASS" : "FAIL"}`,
  );
  console.log(`  Hard failures:   ${failures}  (required: 0)  ${failures === 0 ? "PASS" : "FAIL"}`);

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  pool.end().finally(() => process.exit(1));
});
