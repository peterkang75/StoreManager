import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, autoSubmitExpiredCycleShifts } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabaseIfEmpty } from "./seed";
import { db } from "./db";
import { sql } from "drizzle-orm";

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

(async () => {
  await registerRoutes(httpServer, app);
  await seedDatabaseIfEmpty();
  await fixViaEmailSenders();
  await fixGenericServiceSenders();
  await sanitizeInboxBodies();

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
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
