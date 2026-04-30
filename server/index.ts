import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, autoSubmitExpiredCycleShifts } from "./routes";
import { runBootstrapMigrations } from "./bootstrap-migrations";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabaseIfEmpty } from "./seed";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePermission } from "./middleware/auth";

// ── HTML → plain text (same logic as in routes.ts) ────────────────────────────
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── One-time startup: fix universal_inbox rows where senderEmail is wrong ─────
// Caused by Google Groups "via" format:
//   'real@supplier.com' via GroupName <alias@eatem.com.au>
// The old parser used the <alias> address — this re-extracts the real sender.
async function fixViaEmailSenders() {
  try {
    const rows = await db.execute(sql`
      SELECT id, sender_email, sender_name, raw_payload
      FROM universal_inbox
      WHERE raw_payload->'headers'->>'from' ILIKE '% via %'
         OR sender_name ILIKE '% via %'
    `);

    const records = rows.rows as {
      id: string;
      sender_email: string;
      sender_name: string | null;
      raw_payload: any;
    }[];

    if (records.length === 0) {
      console.log("[via-fix] No via-pattern records found.");
      return;
    }

    console.log(`[via-fix] Found ${records.length} record(s) with via-pattern — re-parsing…`);

    const viaEmailPattern =
      /^["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?\s+via\s+/i;

    function extractEmailAndName(h: string): { email: string; name: string | null } {
      const m = h.match(/<([^>]+)>/);
      const email = (m ? m[1] : h).trim().toLowerCase();
      const rawName = h.includes("<")
        ? h.split("<")[0].trim().replace(/^["'\s]+|["'\s]+$/g, "")
        : "";
      return { email, name: rawName || null };
    }

    let updated = 0;
    for (const row of records) {
      const rawHeaderFrom = (row.raw_payload?.headers?.from ?? "").toString();
      const rawXOrigSender = (
        row.raw_payload?.headers?.["x-original-sender"] ?? ""
      ).toString().trim();
      const senderName: string = (row.sender_name ?? "").toString();

      let trueEmail: string | null = null;
      let trueName: string | null = null;

      if (rawXOrigSender) {
        const e = extractEmailAndName(rawXOrigSender);
        trueEmail = e.email;
        trueName = e.name ?? trueEmail;
      } else {
        // Pattern A: email address before "via" keyword
        //   e.g. "'real@supplier.com' via Accounts <alias@eatem.com.au>"
        const viaInFrom = rawHeaderFrom.match(viaEmailPattern);
        const viaInName = senderName.match(viaEmailPattern);

        if (viaInFrom) {
          trueEmail = viaInFrom[1].toLowerCase();
          trueName = trueEmail;
        } else if (viaInName) {
          trueEmail = viaInName[1].toLowerCase();
          trueName = trueEmail;
        } else {
          // Pattern B: display name before "via" keyword
          //   e.g. "'Natalie Brown' via Accounts <accounts@eatem.com.au>"
          //   We can't extract the real email from From — try X-Original-Sender
          //   and Reply-To from the stored raw_payload headers.
          const rawHeaders = row.raw_payload?.headers ?? {};
          const rawXOrig2  = (rawHeaders["x-original-sender"] ?? "").toString().trim();
          const rawReplyTo = (rawHeaders["reply-to"] ?? rawHeaders["reply_to"] ?? "").toString().trim();

          // Clean up the display name regardless (strip "via GroupName" suffix)
          const nameBeforeVia = senderName
            .replace(/\s+via\s+.*/i, "")
            .replace(/^["']+|["']+$/g, "")
            .trim();

          if (rawXOrig2) {
            const e = extractEmailAndName(rawXOrig2);
            if (e.email && e.email !== row.sender_email) {
              trueEmail = e.email;
              trueName  = e.name ?? (nameBeforeVia || null);
            }
          } else if (rawReplyTo) {
            const e = extractEmailAndName(rawReplyTo);
            if (e.email && e.email !== row.sender_email) {
              trueEmail = e.email;
              trueName  = e.name ?? (nameBeforeVia || null);
            }
          }

          if (!trueEmail) {
            // Cannot recover real email — but at least fix the display name
            if (nameBeforeVia && nameBeforeVia !== row.sender_name) {
              await db.execute(sql`
                UPDATE universal_inbox SET sender_name = ${nameBeforeVia} WHERE id = ${row.id}
              `);
              updated++;
              console.log(`[via-fix] Pattern B name fixed ${row.id}: "${row.sender_name}" → "${nameBeforeVia}"`);
            }
            continue;
          }
        }
      }

      if (!trueEmail || trueEmail === row.sender_email) continue; // already correct

      await db.execute(sql`
        UPDATE universal_inbox
        SET sender_email = ${trueEmail},
            sender_name  = ${trueName}
        WHERE id = ${row.id}
      `);
      updated++;
      console.log(`[via-fix] Fixed record ${row.id}: "${row.sender_email}" → "${trueEmail}"`);
    }

    console.log(`[via-fix] Done — ${updated} record(s) corrected.`);
  } catch (err) {
    console.error("[via-fix] Error:", err);
  }
}

// ── One-time startup: fix records sent via Xero / MYOB / QuickBooks ──────────
// These services send FROM their own domain (e.g. messaging-service@post.xero.com)
// but always put the real supplier address in Reply-To.
// Old records were stored with the service email — we fix them here.
async function fixGenericServiceSenders() {
  try {
    const GENERIC_DOMAINS = [
      "post.xero.com", "xero.com",
      "myob.com", "myobaccountsright.com.au",
      "quickbooks.com", "intuit.com", "qbo.intuit.com",
      "invoicing.squareup.com", "mail.wave.com",
      "freshbooks.com", "sage.com",
      "numberkeepers.com.au",
    ];

    // Build a SQL LIKE condition for each domain
    const domainConditions = GENERIC_DOMAINS.map(d => `sender_email ILIKE '%@${d}'`).join(" OR ");

    const rows = await db.execute(sql.raw(`
      SELECT id, sender_email, sender_name, subject, raw_payload
      FROM universal_inbox
      WHERE ${domainConditions}
    `));

    const records = rows.rows as {
      id: string;
      sender_email: string;
      sender_name: string | null;
      subject: string;
      raw_payload: any;
    }[];

    if (records.length === 0) {
      console.log("[generic-service-fix] No generic-service records found.");
      return;
    }

    console.log(`[generic-service-fix] Found ${records.length} record(s) — re-parsing Reply-To…`);

    function extractEmailAndName(h: string): { email: string; name: string | null } {
      const m = h.match(/<([^>]+)>/);
      const email = (m ? m[1] : h).trim().toLowerCase();
      const rawName = h.includes("<") ? h.split("<")[0].trim().replace(/^["'\s]+|["'\s]+$/g, "") : "";
      return { email, name: rawName || null };
    }

    function extractSupplierFromSubject(subj: string): string | null {
      const patterns = [
        /^Invoice from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^Statement from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^Remittance Advice from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^Credit Note from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^Quote from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^Receipt from (.+?)(?:\s+for\s+|\s*[-–|]|\s*$)/i,
        /^(.+?)\s+sent you an? (?:invoice|statement|quote|receipt|credit note)/i,
        /^(?:INV|BILL|STMT)-\S+\s+from (.+?)(?:\s*[-–|]|\s*$)/i,
      ];
      for (const p of patterns) {
        const m = subj.match(p);
        if (m?.[1]) return m[1].trim();
      }
      return null;
    }

    let updated = 0;
    for (const row of records) {
      const rawHeaders = row.raw_payload?.headers ?? {};
      const rawReplyTo = (
        rawHeaders["reply-to"] ?? rawHeaders.reply_to ?? ""
      ).toString().trim();

      let trueEmail: string | null = null;
      let trueName: string | null = null;

      if (rawReplyTo) {
        const extracted = extractEmailAndName(rawReplyTo);
        if (extracted.email && extracted.email !== row.sender_email) {
          trueEmail = extracted.email;
          trueName  = extracted.name ?? row.sender_name;
        }
      }

      // No Reply-To: try to recover a supplier name from the subject
      if (!trueEmail) {
        const nameFromSubject = extractSupplierFromSubject(row.subject ?? "");
        if (nameFromSubject && nameFromSubject !== row.sender_name) {
          // Keep senderEmail (it's the service address) but fix the display name
          await db.execute(sql`
            UPDATE universal_inbox
            SET sender_name = ${nameFromSubject}
            WHERE id = ${row.id}
          `);
          updated++;
          console.log(`[generic-service-fix] Updated name for ${row.id}: "${row.sender_name}" → "${nameFromSubject}"`);
        }
        continue;
      }

      await db.execute(sql`
        UPDATE universal_inbox
        SET sender_email = ${trueEmail},
            sender_name  = ${trueName}
        WHERE id = ${row.id}
      `);
      updated++;
      console.log(`[generic-service-fix] Fixed ${row.id}: "${row.sender_email}" → "${trueEmail}" (${trueName})`);
    }

    console.log(`[generic-service-fix] Done — ${updated} record(s) updated.`);
  } catch (err) {
    console.error("[generic-service-fix] Error:", err);
  }
}

// ── One-time startup: sanitize any universal_inbox rows that have raw HTML/CSS ─
async function sanitizeInboxBodies() {
  try {
    // Fetch all rows that may contain raw HTML patterns
    const rows = await db.execute(sql`
      SELECT id, body, raw_payload
      FROM universal_inbox
      WHERE body LIKE '%<%'
         OR body LIKE '%@media%'
         OR body LIKE '%font-family%'
         OR body LIKE '%<!DOCTYPE%'
    `);

    const records = rows.rows as { id: string; body: string; raw_payload: any }[];

    if (records.length === 0) {
      console.log("[inbox-sanitize] No records need sanitization.");
      return;
    }

    console.log(`[inbox-sanitize] Found ${records.length} record(s) with potential HTML/CSS — sanitizing…`);

    let updated = 0;
    for (const row of records) {
      // Prefer re-extracting from rawPayload.html so we get the cleanest result
      const rawHtml: string | null = row.raw_payload?.html ?? null;
      const cleanBody = rawHtml
        ? htmlToPlainText(rawHtml).slice(0, 8000)
        : htmlToPlainText(row.body).slice(0, 8000);

      if (cleanBody !== row.body) {
        await db.execute(sql`
          UPDATE universal_inbox SET body = ${cleanBody} WHERE id = ${row.id}
        `);
        updated++;
        console.log(`[inbox-sanitize] Updated record ${row.id}`);
      }
    }

    console.log(`[inbox-sanitize] Done — ${updated} record(s) updated.`);
  } catch (err) {
    console.error("[inbox-sanitize] Error during sanitization:", err);
  }
}

// ── One-time startup: import Connecteam rosters 2026-03-23 ~ 2026-04-05 ──────
async function importConnecteamRosters() {
  try {
    const existing = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM rosters
      WHERE date >= '2026-03-23' AND date <= '2026-04-05'
    `);
    const cnt = parseInt((existing.rows[0] as any).cnt, 10);
    if (cnt > 0) {
      console.log(`[roster-import] Already have ${cnt} records — skipping.`);
      return;
    }

    const records: { storeId: string; employeeId: string; date: string; startTime: string; endTime: string }[] = [
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-03-23", startTime: "06:00", endTime: "13:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-23", startTime: "06:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "b0e5075b-f1ed-4aa8-b5a7-d3e64ba616d9", date: "2026-03-23", startTime: "06:30", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-23", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "0fb47380-81c8-4003-944b-a55546adb1a7", date: "2026-03-23", startTime: "08:30", endTime: "15:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "64b6d862-7d53-4319-acf4-1c40ad084d13", date: "2026-03-23", startTime: "13:00", endTime: "16:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-23", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "b0e5075b-f1ed-4aa8-b5a7-d3e64ba616d9", date: "2026-03-24", startTime: "06:00", endTime: "16:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-24", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-24", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-24", startTime: "06:30", endTime: "17:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-24", startTime: "08:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-24", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-03-25", startTime: "06:00", endTime: "10:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-25", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "d33c98a5-8ae5-4892-8174-44c46c876e92", date: "2026-03-25", startTime: "06:30", endTime: "17:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-25", startTime: "06:30", endTime: "15:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "b0e5075b-f1ed-4aa8-b5a7-d3e64ba616d9", date: "2026-03-25", startTime: "08:00", endTime: "16:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a36925bf-ee8b-4e93-9d28-f241c3c5dd9a", date: "2026-03-25", startTime: "08:00", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-25", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-03-26", startTime: "06:00", endTime: "11:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "d33c98a5-8ae5-4892-8174-44c46c876e92", date: "2026-03-26", startTime: "06:30", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-26", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-26", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-26", startTime: "07:30", endTime: "16:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-26", startTime: "08:00", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-26", startTime: "13:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "10b6c67e-2ca1-4be5-8c83-f587dbbc21a7", date: "2026-03-26", startTime: "15:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-03-27", startTime: "06:00", endTime: "11:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-27", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-27", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-27", startTime: "06:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "64b6d862-7d53-4319-acf4-1c40ad084d13", date: "2026-03-27", startTime: "07:30", endTime: "16:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-27", startTime: "08:00", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "b0e5075b-f1ed-4aa8-b5a7-d3e64ba616d9", date: "2026-03-27", startTime: "13:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "10b6c67e-2ca1-4be5-8c83-f587dbbc21a7", date: "2026-03-27", startTime: "14:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "d33c98a5-8ae5-4892-8174-44c46c876e92", date: "2026-03-28", startTime: "06:30", endTime: "17:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-28", startTime: "06:30", endTime: "15:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-28", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-28", startTime: "08:30", endTime: "14:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-28", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "57d9e543-478d-4653-9432-f9578dea9a61", date: "2026-03-28", startTime: "13:30", endTime: "18:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-28", startTime: "14:00", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a36925bf-ee8b-4e93-9d28-f241c3c5dd9a", date: "2026-03-28", startTime: "14:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "64b6d862-7d53-4319-acf4-1c40ad084d13", date: "2026-03-28", startTime: "14:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "10b6c67e-2ca1-4be5-8c83-f587dbbc21a7", date: "2026-03-28", startTime: "14:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "d33c98a5-8ae5-4892-8174-44c46c876e92", date: "2026-03-29", startTime: "06:30", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-29", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-29", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-29", startTime: "08:30", endTime: "14:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-29", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "57d9e543-478d-4653-9432-f9578dea9a61", date: "2026-03-29", startTime: "13:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-29", startTime: "14:00", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a36925bf-ee8b-4e93-9d28-f241c3c5dd9a", date: "2026-03-29", startTime: "14:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "64b6d862-7d53-4319-acf4-1c40ad084d13", date: "2026-03-29", startTime: "14:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "10b6c67e-2ca1-4be5-8c83-f587dbbc21a7", date: "2026-03-29", startTime: "14:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-03-30", startTime: "06:00", endTime: "13:00" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "b0e5075b-f1ed-4aa8-b5a7-d3e64ba616d9", date: "2026-03-30", startTime: "06:30", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-30", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-30", startTime: "06:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "0fb47380-81c8-4003-944b-a55546adb1a7", date: "2026-03-30", startTime: "08:30", endTime: "15:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-30", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "57d9e543-478d-4653-9432-f9578dea9a61", date: "2026-03-31", startTime: "06:00", endTime: "10:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-03-31", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-03-31", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-03-31", startTime: "06:30", endTime: "17:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-03-31", startTime: "08:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-03-31", startTime: "13:30", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "63b1a805-7571-46b8-8269-ad2f877c7193", date: "2026-04-01", startTime: "06:00", endTime: "11:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "d33c98a5-8ae5-4892-8174-44c46c876e92", date: "2026-04-01", startTime: "06:30", endTime: "17:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "0b0d01bc-0d87-4f3f-9e43-aa7cc6a5f0ad", date: "2026-04-01", startTime: "06:30", endTime: "14:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "a84c0443-f894-44f5-bbea-a0612cf30377", date: "2026-04-01", startTime: "06:30", endTime: "15:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "9af4c4d1-1c47-4edb-becc-7ed37b5742a4", date: "2026-04-01", startTime: "07:30", endTime: "16:00" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "e19c05a3-799d-4d16-9032-f83f6df84d2e", date: "2026-04-01", startTime: "08:00", endTime: "18:30" },
      { storeId: "328c374c-1e25-48f6-81b2-99a2d6ccca4e", employeeId: "da7c9470-62b3-472c-bd7f-8d827dba194d", date: "2026-04-01", startTime: "13:30", endTime: "18:30" },
      { storeId: "3a951c2a-4722-4195-b05c-e5d97f786e7e", employeeId: "10b6c67e-2ca1-4be5-8c83-f587dbbc21a7", date: "2026-04-01", startTime: "15:30", endTime: "18:30" },
    ];

    const values = records
      .map(r => `(gen_random_uuid(), '${r.storeId}', '${r.employeeId}', '${r.date}', '${r.startTime}', '${r.endTime}', NOW(), NOW())`)
      .join(", ");

    await db.execute(sql.raw(
      `INSERT INTO rosters (id, store_id, employee_id, date, start_time, end_time, created_at, updated_at) VALUES ${values}`
    ));
    console.log(`[roster-import] Imported ${records.length} Connecteam shifts (2026-03-23 ~ 2026-04-05).`);
  } catch (err) {
    console.error("[roster-import] Error:", err);
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && res.statusCode >= 400) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

// ── Phase B: role-based authentication for /api/* (excluding bypassed paths) ──
// Phase B is fully live as of 2026-04-30 — the temporary Basic Auth gate has
// been removed. This middleware now stands alone in front of all /api/*
// requests except: auth/login routes, portal routes (Phase 0 per-route guard),
// external webhooks, and token-gated public endpoints.
// (Step 7 removed: ADMIN_AUTH_USER, ADMIN_AUTH_PASS, isPortalOrPublicPath, and the Basic Auth handler.)
function isAuthBypassedApi(p: string): boolean {
  // Login routes themselves
  if (p.startsWith("/api/auth/")) return true;
  // Portal routes — already guarded by requirePortalAuth per-route
  if (p.startsWith("/api/portal/")) return true;
  // External webhook callbacks
  if (p.startsWith("/api/webhooks/")) return true;
  // Token-gated public endpoints (token in URL/body)
  if (p.startsWith("/api/onboarding/")) return true;
  if (p === "/api/direct-register") return true;
  return false;
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (isAuthBypassedApi(req.path)) return next();
  // Compose requireAuth → requirePermission. requireAuth ends the request with
  // 401 on failure (without calling next), so requirePermission only runs on success.
  requireAuth(req, res, () => {
    requirePermission()(req, res, next);
  });
});

(async () => {
  await runBootstrapMigrations();
  await registerRoutes(httpServer, app);
  await seedDatabaseIfEmpty();
  await fixViaEmailSenders();
  await fixGenericServiceSenders();
  await sanitizeInboxBodies();
  await importConnecteamRosters();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
