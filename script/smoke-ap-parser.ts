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
