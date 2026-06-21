// Client-first exposure ranking (page 2). Scores how dangerous each bill is to
// a given client WITHOUT needing an approved delta, so the whole current-session
// docket can be ordered the moment a client is picked. Deterministic and cheap
// (no model calls); the sharper AI read happens later, on drill-in.
//
// Signal, in rough order of weight:
//   1. Practice-area overlap   the bill and the client share a BCF practice group
//   2. Keyword overlap         the client's domain terms appear in the bill text
//   3. Act hit                 the client names an Act the bill touches
//   4. Momentum                a bill closer to law is more pressing
import type { Bill, Client } from "../../src/types.js";
import { PRACTICE_AREAS } from "../../src/lib/practiceAreas.js";
import { bandFromScore, type ScanBand } from "./clientScanCore.js";

export interface RankedBill {
  billId: string;
  score: number; // 0-100, backend-only (never serialized to the client)
  band: ScanBand;
  rationale: string;
  topAreas: string[];
  actTitles: string[];
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const AREA_MATCHERS = PRACTICE_AREAS.map((p) => ({
  label: p.label,
  re: new RegExp(`\\b(?:${p.keywords.map(esc).join("|")})\\b`, "i"),
}));

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are", "our",
  "its", "their", "they", "any", "all", "act", "acts", "inc", "ltd", "canada",
  "canadian", "company", "client", "business", "services", "service", "operations",
  "including", "across", "other", "such", "which", "under", "over", "per",
]);

/** Significant lowercase tokens (>=4 chars, not a stopword) from a client's profile. */
function clientTokens(c: Client): Set<string> {
  const text = [
    c.industry,
    c.description,
    c.operations,
    c.policies,
    c.termsAndConditions,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const out = new Set<string>();
  for (const w of text.split(/[^a-z]+/)) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return out;
}

function clientAreas(c: Client): Set<string> {
  const text = [c.industry, c.description, c.operations, c.policies, c.termsAndConditions]
    .filter(Boolean)
    .join(" ");
  const out = new Set<string>();
  for (const m of AREA_MATCHERS) if (m.re.test(text)) out.add(m.label);
  return out;
}

/** The Acts a bill touches, from its clause targets + statute citation. */
export function billActTitles(bill: Bill): string[] {
  const acts = new Set<string>();
  for (const clause of bill.clauses ?? []) {
    for (const a of clause.targetActs ?? []) {
      if (a?.trim()) acts.add(a.trim());
    }
  }
  if (bill.statuteCitation?.trim()) acts.add(bill.statuteCitation.trim());
  return [...acts];
}

function scoreBill(
  bill: Bill,
  cAreas: Set<string>,
  cTokens: Set<string>,
): RankedBill {
  const acts = billActTitles(bill);
  const actCount = Math.max(1, acts.length);
  // Specificity: a tightly-scoped bill (<=3 Acts) is a sharper danger than a
  // 100-Act omnibus that merely touches the client's area in passing.
  const focus = Math.min(1, 3 / actCount);

  const titleText = `${bill.title ?? ""} ${bill.shortTitle ?? ""}`.toLowerCase();
  const bodyText = `${acts.join(" ")} ${bill.summary ?? ""}`.toLowerCase();

  const bAreas = bill.practiceAreas ?? [];
  const shared = [...cAreas].filter((a) => bAreas.includes(a));

  let score = 0;
  const matched: string[] = [];

  // 1. Practice-area overlap is the core semantic bridge (pharmaceutical -> drugs),
  //    discounted by breadth so an omnibus doesn't outrank a focused bill.
  score += Math.min(2, shared.length) * 30 * (0.4 + 0.6 * focus);
  // 2. A focused bill squarely in the client's domain is the real exposure.
  if (shared.length > 0 && bAreas.length <= 3) score += 22;

  // 3. Title hits: the bill is explicitly ABOUT the client's terms (specific).
  let titleHits = 0;
  for (const tok of cTokens) {
    if (titleHits >= 3) break;
    if (titleText.includes(tok)) {
      score += 15;
      titleHits += 1;
      matched.push(tok);
    }
  }
  // 4. Body/Act token overlap, focus-weighted and minor.
  let bodyHits = 0;
  for (const tok of cTokens) {
    if (bodyHits >= 6) break;
    if (!titleText.includes(tok) && bodyText.includes(tok)) {
      score += 3 * focus;
      bodyHits += 1;
      if (matched.length < 4) matched.push(tok);
    }
  }

  // 5. Momentum: a bill closer to becoming law presses harder.
  const m = bill.legislativeMomentum;
  if (m === "in_force" || m === "passed") score += 8;
  else if (m === "advanced") score += 5;
  else if (m === "active") score += 2;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const topAreas = shared.length ? shared : bAreas.slice(0, 2);
  const uniqueMatched = [...new Set(matched)].slice(0, 3);
  const parts: string[] = [];
  if (shared.length) parts.push(`In the client's ${shared.slice(0, 2).join(" and ")} work`);
  if (uniqueMatched.length) parts.push(`mentions ${uniqueMatched.join(", ")}`);
  if (acts.length === 1) parts.push(`amends the ${acts[0]}`);
  else if (acts.length > 8) parts.push(`a broad bill touching ${acts.length} Acts`);
  else if (acts.length) parts.push(`amends ${acts.slice(0, 2).join(", ")}`);
  if (parts.length === 0) parts.push("No clear overlap with this client's profile");
  const rationale = parts.join("; ") + ".";

  return { billId: bill.id, score, band: bandFromScore(score), rationale, topAreas, actTitles: acts };
}

/** Rank a set of bills against a client, most dangerous first. */
export function rankBillsForClient(client: Client, bills: Bill[]): RankedBill[] {
  const cAreas = clientAreas(client);
  const cTokens = clientTokens(client);
  return bills
    .map((b) => scoreBill(b, cAreas, cTokens))
    .sort((a, b) => b.score - a.score || a.billId.localeCompare(b.billId));
}
