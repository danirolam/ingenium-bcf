// Plain-language hygiene for bill text. Em/en dashes read as machine-written,
// so we replace them before bills reach the UI, wherever the bills come from
// (the committed snapshot, the Blob overlay on Vercel, or a live upload/refresh).
// Mirrors humanizeDashes() in clientScanCore.ts; kept separate so the bills
// pipeline (a different stage) doesn't import the client-scan module.

/** Spaced connector -> comma; tight dash between words/numbers -> hyphen (so
 *  "Canada—United Kingdom" reads "Canada-United Kingdom"); anything left -> comma. */
export function tidyDashes(s: unknown): string {
  if (typeof s !== "string" || !s) return s as string;
  // Figure/en/em/horizontal-bar dash + minus sign; plain and nb hyphen kept.
  return s
    .replace(/\s+[‒-―−]\s+/g, ", ")
    .replace(/([A-Za-z0-9)])[‒-―−]([A-Za-z0-9(])/g, "$1-$2")
    .replace(/[‒-―−]/g, ", ")
    .replace(/ +([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",");
}

const BILL_TEXT_FIELDS = [
  "title",
  "shortTitle",
  "summary",
  "status",
  "latestActivity",
  "statuteCitation",
] as const;

/** Return a copy of a bill with its human-readable fields de-dashed. Structured
 *  ids, urls, dates and rawJson are left untouched. */
export function scrubBillDisplay<T extends Record<string, any>>(bill: T): T {
  if (!bill || typeof bill !== "object") return bill;
  const out: any = { ...bill };
  for (const k of BILL_TEXT_FIELDS) {
    if (typeof out[k] === "string") out[k] = tidyDashes(out[k]);
  }
  if (Array.isArray(out.clauses)) {
    out.clauses = out.clauses.map((c: any) =>
      c && typeof c === "object"
        ? { ...c, heading: tidyDashes(c.heading), text: tidyDashes(c.text) }
        : c,
    );
  }
  return out;
}
