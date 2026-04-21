// Single source of truth for store brand colours (DESIGN.md palette).
// Sushi    = Primary Dark  (#222222)
// Sandwich = Rausch Red    (#ef4444)
// Anything else falls back to Secondary Gray.
export const STORE_COLORS: Record<string, string> = {
  Sushi: "#222222",
  Sandwich: "#ef4444",
};

export const STORE_COLOR_FALLBACK = "#6a6a6a";

export function storeColorFor(name: string | null | undefined): string {
  if (!name) return STORE_COLOR_FALLBACK;
  return STORE_COLORS[name] ?? STORE_COLOR_FALLBACK;
}
