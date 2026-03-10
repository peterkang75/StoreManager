import { db } from "./db";
import { 
  stores, employees, employeeStoreAssignments, 
  payrolls, cashSalesDetails, financialTransactions 
} from "@shared/schema";
import fs from "fs";
import path from "path";
import { log } from "./index";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const timestampFields = new Set([
  "createdAt", "updatedAt", "executedAt", "expiresAt", "usedAt",
  "clockIn", "clockOut", "approvedAt"
]);

function convertKeys(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    if (timestampFields.has(camelKey) && value != null && typeof value === "string") {
      result[camelKey] = new Date(value);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

export async function seedDatabaseIfEmpty() {
  try {
    const existingStores = await db.select().from(stores).limit(1);
    if (existingStores.length > 0) {
      log("Database already has data, skipping seed", "seed");
      return;
    }

    const seedPath = path.join(process.cwd(), "server", "seed-data.json");
    const altSeedPath = path.join(__dirname, "seed-data.json");
    const finalPath = fs.existsSync(seedPath) ? seedPath : fs.existsSync(altSeedPath) ? altSeedPath : null;
    if (!finalPath) {
      log("No seed-data.json found, skipping seed", "seed");
      return;
    }

    const seedData = JSON.parse(fs.readFileSync(finalPath, "utf-8"));
    log("Database is empty, seeding from seed-data.json...", "seed");

    const tableMap: [any, string][] = [
      [stores, "stores"],
      [employees, "employees"],
      [employeeStoreAssignments, "employee_store_assignments"],
      [payrolls, "payrolls"],
      [cashSalesDetails, "cash_sales_details"],
      [financialTransactions, "financial_transactions"],
    ];

    for (const [table, key] of tableMap) {
      const rows = (seedData[key] || []).map(convertKeys);
      if (rows.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await db.insert(table).values(batch).onConflictDoNothing();
        }
        log(`Seeded ${rows.length} rows into ${key}`, "seed");
      }
    }

    log("Database seeding complete!", "seed");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
