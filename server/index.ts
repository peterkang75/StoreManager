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

      let trueEmail: string;
      let trueName: string | null;

      if (rawXOrigSender) {
        const e = extractEmailAndName(rawXOrigSender);
        trueEmail = e.email;
        trueName = e.name ?? trueEmail;
      } else {
        const viaMatch = rawHeaderFrom.match(viaEmailPattern);
        if (!viaMatch) continue; // pattern didn't match — skip
        trueEmail = viaMatch[1].toLowerCase();
        trueName = trueEmail; // only the email is available in the quoted section
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
