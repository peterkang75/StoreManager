// Store detection from free text using the admin-curated stores.bodyAliases
// (business names, account numbers, …). Case-insensitive substring match;
// whitespace inside an alias is collapsed so "7092 888 010" still hits
// "7092 888  010" or "7092888010". Returns the first matching store id.
export function resolveStoreFromAliases(
  haystack: string | null | undefined,
  stores: Array<{ id: string; bodyAliases?: string[] | null }>,
): string | null {
  if (!haystack) return null;
  const hayLow = haystack.toLowerCase();
  const hayCompact = hayLow.replace(/\s+/g, "");
  for (const store of stores) {
    for (const alias of store.bodyAliases ?? []) {
      const a = (alias ?? "").trim().toLowerCase();
      if (a.length < 3) continue;
      if (hayLow.includes(a)) return store.id;
      const aCompact = a.replace(/\s+/g, "");
      if (aCompact.length >= 4 && hayCompact.includes(aCompact)) return store.id;
    }
  }
  return null;
}
