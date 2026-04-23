// GuniSMS adapter — thin, single-function.
//
// The user has an existing GuniSMS account. Once they paste the API spec
// (endpoint URL, auth header, request body shape), fill in `callGuniSms`.
// Until then the adapter returns `{ ok: false, error: "not configured" }`
// so callers can fall back to manual link sharing.

type SmsResult = { ok: true; id?: string } | { ok: false; error: string };

const GUNISMS_API_URL = process.env.GUNISMS_API_URL || "";
const GUNISMS_API_KEY = process.env.GUNISMS_API_KEY || "";
const GUNISMS_SENDER_ID = process.env.GUNISMS_SENDER_ID || "";

/**
 * Normalise AU mobile numbers to E.164 (+61...). Rejects obvious non-mobiles
 * (AU mobiles start with 04 locally → 614 in E.164). Returns null when the
 * input doesn't match.
 */
export function normalizeAuPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Already E.164-looking AU mobile: 61xxxxxxxxx (11 digits)
  if (digits.startsWith("61") && digits.length === 11 && digits[2] === "4") {
    return `+${digits}`;
  }
  // Local AU mobile: 04xxxxxxxx (10 digits)
  if (digits.startsWith("04") && digits.length === 10) {
    return `+61${digits.slice(1)}`;
  }
  // 4xxxxxxxx (9 digits, leading 0 dropped in some inputs)
  if (digits.startsWith("4") && digits.length === 9) {
    return `+61${digits}`;
  }
  return null;
}

async function callGuniSms(to: string, body: string): Promise<SmsResult> {
  if (!GUNISMS_API_KEY || !GUNISMS_API_URL) {
    return { ok: false, error: "not configured" };
  }

  try {
    // Placeholder request shape. Replace with the real GuniSMS contract once
    // the user provides the spec (endpoint, auth header, field names).
    const res = await fetch(GUNISMS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GUNISMS_API_KEY}`,
      },
      body: JSON.stringify({
        to,
        message: body,
        ...(GUNISMS_SENDER_ID ? { sender: GUNISMS_SENDER_ID } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `GuniSMS ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return { ok: true, id: data.id ?? data.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const normalized = normalizeAuPhone(to);
  if (!normalized) {
    return { ok: false, error: `Invalid AU mobile number: ${to}` };
  }
  return callGuniSms(normalized, body);
}
