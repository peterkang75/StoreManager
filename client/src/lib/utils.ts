import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse visa expiry dates stored in various formats across the database.
 * Handles: YYYY-MM-DD (ISO), Korean datetime strings, DD-MM-YYYY and MM-DD-YYYY
 * (hyphen or slash). For ambiguous cases where both parts ≤ 12, defaults to
 * DD-MM-YYYY (Australian convention).
 */
export function parseVisaDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD (e.g. "2026-09-30")
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d);
  }

  // Korean datetime: "2025. 8. 17. 오전 12:00:00" or "2025.8.17" etc.
  const krMatch = s.match(/(\d{4})[.\s]+(\d{1,2})[.\s]+(\d{1,2})/);
  if (krMatch) {
    const [, y, m, d] = krMatch.map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
  }

  // Slash-delimited: DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch.map(Number);
    if (a > 12) return new Date(y, b - 1, a);   // first > 12 → DD/MM/YYYY
    if (b > 12) return new Date(y, a - 1, b);   // second > 12 → MM/DD/YYYY
    return new Date(y, b - 1, a);               // ambiguous → Australian DD/MM default
  }

  // Hyphen-delimited: DD-MM-YYYY or MM-DD-YYYY (e.g. "01-12-2026", "08-30-2026")
  const hyphenMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (hyphenMatch) {
    const [, a, b, y] = hyphenMatch.map(Number);
    if (a > 12) return new Date(y, b - 1, a);   // first > 12 → DD-MM-YYYY
    if (b > 12) return new Date(y, a - 1, b);   // second > 12 → MM-DD-YYYY
    return new Date(y, b - 1, a);               // ambiguous → Australian DD-MM default
  }

  // Fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
