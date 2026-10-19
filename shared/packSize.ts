// Pack size read from a supplier's product name, so prices can be compared per
// kg / L / each. A guess: the owner's value (stored on the card) always wins.
//   "MAYONNAISE WHOLE EGG 10KG"      EA   -> 10 kg
//   "BONSOY 6 X 1L TETRA PACKS"      CAR  -> 6 L    (outer count only for carton-type units)
//   "KENKO MAYONNEISE 1KG/12"        EA   -> 1 kg   ("/12" is how many come in the case)
//   "BREADED PRAWN 25GX40P/10"       EA   -> 1 kg   (25 g x 40 pieces)
//   "CHEESE HALOUMI 750GM"           CTN-5 -> 3.75 kg
//   "Cup 8oz T/A HC CAMPOS x1000"    EA   -> 1000 ea
//   Green Star fillet                KG   -> 1 kg
export type PackUnit = "kg" | "L" | "ea";
export interface Pack { qty: number; unit: PackUnit }

// a letter may not follow the unit, except "x" ("25GX40P")
const SIZE = String.raw`(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GR|GRM|L|LT|LTR|ML)(?![A-WYZa-wyz])`;
const CASE_UNITS = /^(CAR|CTN|CARTON|BOX|CASE|CS|PK|PACK)$/i;

function toBase(n: number, u: string): Pack {
  const k = u.toUpperCase();
  if (k.startsWith("K")) return { qty: n, unit: "kg" };
  if (k.startsWith("G")) return { qty: n / 1000, unit: "kg" };
  if (k === "ML") return { qty: n / 1000, unit: "L" };
  return { qty: n, unit: "L" };
}
const round = (n: number) => Math.round(n * 10000) / 10000;

export function parsePack(name: string, unit?: string | null): Pack | null {
  const u = (unit ?? "").trim();
  const ctnN = u.match(/^CTN-(\d+)$/i);            // Foodlink: "CTN-5" = carton of 5
  const caseUnit = CASE_UNITS.test(u);
  const text = ` ${name} `;
  const isEgg = /\bEGGS\b/i.test(name);           // "700G" on eggs is the egg grade, not the pack ("WHOLE EGG" mayo is not eggs)

  // "15 DOZ" (eggs)
  const doz = text.match(/\b(\d+)\s*DOZ\b/i);
  // "25GX40P", "80g 10p" — the space-separated form only for grams ("SUSHI EBI 4L 30p" is a prawn grade)
  const inner = text.match(new RegExp(String.raw`${SIZE}\s*[xX]\s*(\d+)\s*(?:P|PC|PCS|PK|S)\b`, "i"))
    ?? text.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(G|GM)\s+(\d+)\s*(?:P|PC|PCS)\b`, "i")); // per-piece grams only ("1kg 50p" is the total)
  // "6 X 1L", "6X2KG", "12 x 1L"
  const outer = text.match(new RegExp(String.raw`(\d+)\s*[xX]\s*${SIZE}`));
  const sizes = Array.from(text.matchAll(new RegExp(SIZE, "gi"))).map(m => toBase(Number(m[1]), m[2]));

  // a carton of containers: "FOOD BOWL … 750ML 300'S" is 300 bowls, not 750 ml
  const caseCount = caseUnit ? text.match(/\b(\d+)'S\b/i) : null;

  let pack: Pack | null = null;
  if (caseCount) {
    pack = { qty: Number(caseCount[1]), unit: "ea" };
  } else if (doz) {
    pack = { qty: Number(doz[1]) * 12, unit: "ea" };
  } else if (inner && !isEgg) {
    const b = toBase(Number(inner[1]), inner[2]);
    pack = { qty: b.qty * Number(inner[3]), unit: b.unit };
  } else if (outer && !isEgg) {
    const b = toBase(Number(outer[2]), outer[3]);
    pack = { qty: caseUnit ? b.qty * Number(outer[1]) : b.qty, unit: b.unit };
  } else if (sizes.length && !isEgg) {
    // several sizes of one kind ("160-189gm 5 kg box", "20G 1kg 50p"): the largest is the pack
    const dim = sizes[0].unit;
    pack = { qty: Math.max(...sizes.filter(x => x.unit === dim).map(x => x.qty)), unit: dim };
  } else if (/^KG$/i.test(u)) {
    pack = { qty: 1, unit: "kg" };
  } else if (/^(L|LT|LTR)$/i.test(u)) {
    pack = { qty: 1, unit: "L" };
  } else if (!isEgg) {
    // counts only: "x1000", "(Box 1000)", "100pk", "36P", "300'S", "100S/48"
    const c = text.match(/(?:[xX]\s?(\d{2,})\b|Box\s+(\d+)|\b(\d+)\s*(?:pk|P|PC|PCS|'S)\b|\b(\d+)S(?=\/))/i);
    const n = c ? Number(c[1] ?? c[2] ?? c[3] ?? c[4]) : NaN;
    if (n > 1) pack = { qty: n, unit: "ea" };
  }
  if (pack && ctnN) pack = { qty: pack.qty * Number(ctnN[1]), unit: pack.unit };
  return pack && pack.qty > 0 ? { qty: round(pack.qty), unit: pack.unit } : null;
}

export function formatPack(p: Pack | null): string {
  if (!p) return "—";
  if (p.unit === "kg" && p.qty < 1) return `${round(p.qty * 1000)}g`;
  if (p.unit === "L" && p.qty < 1) return `${round(p.qty * 1000)}ml`;
  return `${p.qty}${p.unit === "ea" ? "개" : p.unit}`;
}
