import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";

// Inbound mail straight from the owner's Gmail (read-only), replacing Cloudmailin,
// whose free plan rejects any message over 512 KB (Escalate's invoices since June).
// Each message is turned into Cloudmailin's "JSON Normalized" shape and posted to
// our own /api/webhooks/inbound-invoices, so every rule there applies unchanged.
// Message-IDs are kept in inbound_messages so a mail that also arrives through
// Cloudmailin is processed once.

const ACCOUNTS = "accounts@eatem.com.au";
const CLOUDMAILIN_LIMIT = 480 * 1024; // free plan rejects over 512 KB; a little under so nothing near the line is missed (the ledger check stops doubles)
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI ?? "https://storemanager-production-103d.up.railway.app/api/auth/gmail/callback";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ── refresh token at rest: AES-256-GCM, key from the server's secrets ─────────
const key = () => createHash("sha256").update(process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").digest();
function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
function unseal(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map(s => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export const gmailConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// ── OAuth (owner clicks "Gmail 연결" once) ────────────────────────────────────
const pendingStates = new Map<string, number>(); // state -> expiry
export function gmailAuthUrl(): string {
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 10 * 60_000);
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: REDIRECT_URI, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function gmailCallback(code: string, state: string): Promise<string> {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  if (!exp || exp < Date.now()) throw new Error("This sign-in link has expired — press Gmail 연결 again");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  const t: any = await r.json();
  if (!r.ok || !t.refresh_token) throw new Error(`Google did not grant access (${t.error_description ?? t.error ?? r.status})`);
  const profile: any = await (await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
  await db.execute(sql`
    INSERT INTO gmail_connection (id, email, refresh_token, connected_at, last_error)
    VALUES ('main', ${profile.emailAddress ?? null}, ${seal(t.refresh_token)}, now(), NULL)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, connected_at = now(), last_error = NULL`);
  return profile.emailAddress ?? "";
}

export async function gmailDisconnect() {
  await db.execute(sql`DELETE FROM gmail_connection WHERE id = 'main'`);
}

export async function gmailStatus() {
  const [c] = ((await db.execute(sql`SELECT email, connected_at, last_poll_at, last_error, delivered FROM gmail_connection WHERE id = 'main'`)) as any).rows;
  return { configured: gmailConfigured(), connected: !!c, email: c?.email ?? null, connectedAt: c?.connected_at ?? null,
    lastPollAt: c?.last_poll_at ?? null, lastError: c?.last_error ?? null, delivered: Number(c?.delivered ?? 0) };
}

let cachedToken: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const [c] = ((await db.execute(sql`SELECT refresh_token FROM gmail_connection WHERE id = 'main'`)) as any).rows;
  if (!c) throw new Error("Gmail is not connected");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: unseal(c.refresh_token), client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  const t: any = await r.json();
  if (!r.ok) throw new Error(`Gmail access was refused (${t.error_description ?? t.error ?? r.status}) — reconnect Gmail`);
  cachedToken = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function gmailGet(path: string): Promise<any> {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ── Gmail message -> Cloudmailin JSON Normalized ──────────────────────────────
const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export async function toCloudmailinPayload(msg: any, fetchAttachment: (attId: string) => Promise<string>) {
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    const k = String(h.name).toLowerCase();
    if (!(k in headers)) headers[k] = h.value; // first wins (Received etc. repeat)
  }
  headers.message_id = headers["message-id"] ?? "";
  headers.reply_to = headers["reply-to"] ?? "";
  headers.x_original_sender = headers["x-original-sender"] ?? "";
  let plain = "", html = "";
  const attachments: any[] = [];
  const walk = async (part: any) => {
    if (!part) return;
    const mime = String(part.mimeType ?? "");
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      const data = part.body.data ?? await fetchAttachment(part.body.attachmentId);
      attachments.push({ file_name: part.filename, content_type: mime, size: part.body.size ?? 0, disposition: "attachment", content: b64url(data).toString("base64") });
    } else if (mime === "text/plain" && part.body?.data && !plain) plain = b64url(part.body.data).toString("utf8");
    else if (mime === "text/html" && part.body?.data && !html) html = b64url(part.body.data).toString("utf8");
    for (const p of part.parts ?? []) await walk(p);
  };
  await walk(msg.payload);
  return {
    headers, plain, html, attachments,
    envelope: { from: headers.from ?? "", to: headers.to ?? "" },
    _source: "gmail", _gmailId: msg.id,
  };
}

// ── shared dedup with the Cloudmailin path ────────────────────────────────────
/** true when this Message-ID is new (and now recorded). */
export async function claimMessageId(messageId: string, source: string): Promise<boolean> {
  const id = messageId.trim();
  if (!id) return true;
  const r = ((await db.execute(sql`INSERT INTO inbound_messages (message_id, source) VALUES (${id}, ${source}) ON CONFLICT DO NOTHING RETURNING message_id`)) as any).rows;
  return r.length > 0;
}
const seenMessageId = async (id: string) => !!id && (((await db.execute(sql`SELECT 1 FROM inbound_messages WHERE message_id = ${id.trim()}`)) as any).rows.length > 0);

async function deliver(payload: any): Promise<string> {
  const auth = Buffer.from(`${process.env.CLOUDMAILIN_USER}:${process.env.CLOUDMAILIN_PASS}`).toString("base64");
  const r = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/webhooks/inbound-invoices`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` }, body: JSON.stringify(payload),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`webhook ${r.status}: ${body?.error ?? ""}`);
  return body?.action ?? "ok";
}

// What to read: mail to accounts@, plus anything from a registered supplier address
// (some send to the owner directly). Never the rest of the mailbox.
async function searchQuery(extra: string): Promise<string> {
  const emails = (await storage.getSuppliers()).filter(s => s.active).flatMap(s => s.contactEmails ?? []).map(e => e.trim().toLowerCase()).filter(Boolean);
  const from = emails.length ? ` OR from:(${Array.from(new Set(emails)).join(" OR ")})` : "";
  return `(to:${ACCOUNTS} OR deliveredto:${ACCOUNTS} OR cc:${ACCOUNTS}${from}) ${extra}`.trim();
}

async function listIds(q: string, max = 500): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({ q, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const r = await gmailGet(`/messages?${p}`);
    for (const m of r.messages ?? []) ids.push(m.id);
    pageToken = r.nextPageToken ?? "";
  } while (pageToken && ids.length < max);
  return ids;
}

const headerOf = (msg: any, name: string) => (msg.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name)?.value ?? "";
const fetchAtt = (id: string) => (attId: string) => gmailGet(`/messages/${id}/attachments/${attId}`).then(a => a.data as string);

/** One pass over the last few days. Anything already seen (either path) is skipped before attachments are fetched. */
export async function pollGmail(): Promise<{ checked: number; delivered: number; skipped: number }> {
  const out = { checked: 0, delivered: 0, skipped: 0 };
  try {
    for (const id of await listIds(await searchQuery("newer_than:3d"), 300)) {
      out.checked++;
      const meta = await gmailGet(`/messages/${id}?format=metadata&metadataHeaders=Message-ID`);
      const mid = headerOf(meta, "message-id");
      if (!mid || await seenMessageId(mid)) { out.skipped++; continue; }
      const full = await gmailGet(`/messages/${id}?format=full`);
      await deliver(await toCloudmailinPayload(full, fetchAtt(id)));
      out.delivered++;
    }
    await db.execute(sql`UPDATE gmail_connection SET last_poll_at = now(), last_error = NULL, delivered = delivered + ${out.delivered} WHERE id = 'main'`);
  } catch (e: any) {
    await db.execute(sql`UPDATE gmail_connection SET last_poll_at = now(), last_error = ${String(e?.message ?? e).slice(0, 500)} WHERE id = 'main'`);
    throw e;
  }
  return out;
}

let polling = false;
export function startGmailPoll(): void {
  const tick = async () => {
    if (polling || !gmailConfigured()) return;
    const [c] = ((await db.execute(sql`SELECT 1 FROM gmail_connection WHERE id = 'main'`)) as any).rows;
    if (!c) return;
    polling = true;
    try { const r = await pollGmail(); if (r.delivered) console.log("[gmail] poll", r); }
    catch (e: any) { console.error("[gmail] poll failed:", e?.message ?? e); }
    finally { polling = false; }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 5 * 60_000);
}

/**
 * Mail that never reached the app (Cloudmailin rejected it as too big): from
 * registered suppliers only, since `since`. Preview counts per supplier; apply delivers them.
 * Invoices whose number is already in the ledger are left out so nothing doubles.
 */
export async function backfillGmail(since: string, apply: boolean) {
  const suppliers = (await storage.getSuppliers()).filter(s => s.active);
  const supplierOf = (addr: string) => suppliers.find(s => (s.contactEmails ?? []).some(e => e.trim().toLowerCase() === addr));
  const after = since.replace(/-/g, "/");
  const ids = await listIds(await searchQuery(`after:${after}`), 2000);
  const rows: any[] = [];
  const ledger = new Map<string, Set<string>>();
  for (const id of ids) {
    const meta = await gmailGet(`/messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=X-Original-Sender&metadataHeaders=Reply-To&metadataHeaders=Date`);
    // smaller mail did reach the app through Cloudmailin (processed, or kept in Rejected for the recover tool)
    if ((meta.sizeEstimate ?? 0) < CLOUDMAILIN_LIMIT) continue;
    const mid = headerOf(meta, "message-id");
    const subject = headerOf(meta, "subject");
    const addr = (headerOf(meta, "x-original-sender") || headerOf(meta, "from")).match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase() ?? "";
    const sup = supplierOf(addr);
    const base = { gmailId: id, date: headerOf(meta, "date"), from: addr, subject, supplier: sup?.name ?? null };
    if (!sup) continue; // unknown senders stay out of the backfill (they were never invoices we take)
    if (!mid || await seenMessageId(mid)) { rows.push({ ...base, action: "already_seen" }); continue; }
    const num = subject.match(/\b(?:invoice|inv)\s*#?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-\/]*\d)/i)?.[1];
    if (num) {
      if (!ledger.has(sup.id)) ledger.set(sup.id, new Set((await storage.getSupplierInvoices({ supplierId: sup.id })).map(i => (i.invoiceNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""))));
      if (ledger.get(sup.id)!.has(num.toUpperCase().replace(/[^A-Z0-9]/g, ""))) { rows.push({ ...base, number: num, action: "in_ledger" }); continue; }
    }
    if (apply) {
      const full = await gmailGet(`/messages/${id}?format=full`);
      try { rows.push({ ...base, number: num ?? null, action: "delivered", result: await deliver(await toCloudmailinPayload(full, fetchAtt(id))) }); }
      catch (e: any) { rows.push({ ...base, number: num ?? null, action: "failed", error: String(e?.message ?? e) }); }
    } else rows.push({ ...base, number: num ?? null, action: "to_deliver" });
  }
  const summary: Record<string, Record<string, number>> = {};
  for (const r of rows) ((summary[r.supplier] ??= {})[r.action] = (summary[r.supplier]?.[r.action] ?? 0) + 1);
  return { since, apply, scanned: ids.length, rows, summary };
}
