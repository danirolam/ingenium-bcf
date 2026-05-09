import type { Bill, BillClause, LegislativeMomentum } from "../../src/types.js";

const STATUS_TO_MOMENTUM: Array<[RegExp, LegislativeMomentum]> = [
  [/in\s*force/i, "in_force"],
  [/royal\s*assent/i, "passed"],
  [/awaiting\s*royal\s*assent/i, "passed"],
  [/passed/i, "passed"],
  [/third\s*reading/i, "advanced"],
  [/report\s*stage/i, "advanced"],
  [/senate.*(committee|reading|stage)/i, "advanced"],
  [/committee/i, "active"],
  [/second\s*reading/i, "active"],
  [/first\s*reading/i, "early"],
  [/introduced/i, "early"],
  [/defeated/i, "early"],
];

export function mapMomentum(status: string | undefined): LegislativeMomentum {
  if (!status) return "early";
  for (const [re, mom] of STATUS_TO_MOMENTUM) {
    if (re.test(status)) return mom;
  }
  return "early";
}

function pickString(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function flattenClauses(raw: any): BillClause[] {
  const out: BillClause[] = [];
  const candidates = [
    raw?.clauses,
    raw?.sections,
    raw?.provisions,
    raw?.articles,
    raw?.body?.clauses,
    raw?.body?.sections,
  ].find((x) => Array.isArray(x));

  if (Array.isArray(candidates)) {
    candidates.forEach((c: any, i: number) => {
      const text =
        pickString(c, ["text", "body", "content", "clauseText", "provision"]) ?? "";
      if (!text) return;
      out.push({
        id: `cl-${i + 1}`,
        number: pickString(c, ["number", "clauseNumber", "section", "id"]),
        heading: pickString(c, ["heading", "title", "marginalNote", "headnote"]),
        text,
      });
    });
  }

  if (out.length === 0 && typeof raw?.fullText === "string") {
    raw.fullText
      .split(/\n{2,}/)
      .filter((p: string) => p.trim().length > 0)
      .forEach((p: string, i: number) =>
        out.push({ id: `cl-${i + 1}`, text: p.trim() }),
      );
  }

  return out;
}

export function normalizeBill(raw: any): Bill {
  const id =
    pickString(raw, ["id", "billId"]) ??
    `bill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const billNumber =
    pickString(raw, ["billNumber", "number", "billNo", "code"]) ?? "Unknown";

  const title =
    pickString(raw, ["title", "longTitle", "shortTitle", "name"]) ??
    "Untitled bill";

  const status =
    pickString(raw, ["status", "stage", "currentStatus", "latestStage"]) ??
    "Introduced";

  return {
    id,
    billNumber,
    title,
    status,
    legislativeMomentum: mapMomentum(status),
    latestActivity: pickString(raw, [
      "latestActivity",
      "lastMovement",
      "lastEvent",
      "latestEvent",
    ]),
    session: pickString(raw, ["session", "parliament", "legislature"]),
    sourceUrl: pickString(raw, ["sourceUrl", "url", "link"]),
    uploadedAt: new Date().toISOString(),
    rawJson: raw,
    clauses: flattenClauses(raw),
  };
}
