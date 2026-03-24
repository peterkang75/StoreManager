import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./shared/schema";
import { writeFileSync } from "fs";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function main() {
  console.log("Connecting to Dev database...");

  const [rostersData, shiftTimesheetsData, payrollsData] = await Promise.all([
    db.select().from(schema.rosters),
    db.select().from(schema.shiftTimesheets),
    db.select().from(schema.payrolls),
  ]);

  const output = {
    exportedAt: new Date().toISOString(),
    rosters: rostersData,
    shiftTimesheets: shiftTimesheetsData,
    payrolls: payrollsData,
  };

  writeFileSync("payroll_migration_data.json", JSON.stringify(output, null, 2), "utf-8");

  console.log("✓ Export complete:");
  console.log(`  rosters        → ${rostersData.length} records`);
  console.log(`  shiftTimesheets → ${shiftTimesheetsData.length} records`);
  console.log(`  payrolls       → ${payrollsData.length} records`);
  console.log("  Saved to: payroll_migration_data.json");

  await pool.end();
}

main().catch(err => {
  console.error("Export failed:", err);
  process.exit(1);
});
