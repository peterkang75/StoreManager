/** Suggested order: enough for the cover period, minus stock on hand, whole units, never negative. */
export function suggestQty(weekly: number | null, coverWeeks: number, stock: number | null): number | null {
  if (weekly == null) return null;
  return Math.max(0, Math.ceil(weekly * coverWeeks - (stock ?? 0) - 1e-9)); // 1e-9: 2.0000001 from float maths is still 2
}
