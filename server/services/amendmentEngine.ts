// Grounded amendment engine. AI only INTERPRETS a bill's amending instructions
// into structured operations (see interpretAmendments in gemini.ts). Everything
// here is deterministic: verify each operation's anchor exists in the real Act,
// apply the ops to the Act's provisions, and diff before/after by provision.
//
// This is the guardrail that the old delta lacked: the AI never writes the
// "after" text freely — it points at real provisions, and we check it.

// One step in a provision's hierarchical position, e.g. {kind:"section",label:"30"}.
export interface PositionStep {
  kind: string;
  label: string;
}

export interface Provision {
  id: string;
  label: string;
  kind: string;
  heading?: string | null;
  marginalNote?: string | null;
  text: string;
  /** Structured hierarchy path (section → subsection → paragraph → …). */
  path?: PositionStep[];
}

export type AmendOp = "add" | "replace" | "repeal" | "amend";

export interface Amendment {
  clause?: string;
  op: AmendOp;
  anchor: string | null;          // an existing provision label the op targets
  position?: "after" | "before" | "replaces" | "within" | null;
  newLabel?: string | null;
  newMarginalNote?: string | null;
  newText?: string | null;        // verbatim inserted/replacement text from the bill
  note?: string | null;
}

export interface DiffRow {
  status: "unchanged" | "added" | "changed" | "repealed";
  label: string;
  before?: Provision;
  after?: Provision;
}

export const squish = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();

// Normalize a provision label/anchor for matching: drop the word "section" etc.
// and whitespace so "section 2.4", "Section 2.4", "2.4" all compare equal.
export function normLabel(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(sub)?sections?\b|\bparagraphs?\b/g, "")
    .replace(/\s+/g, "")
    .trim();
}

const STEP_KINDS = ["subsection", "paragraph", "subparagraph", "clause"];

// Parse a composed label ("30(1)(o)", "2.4", "“advertisement”") into a
// structured hierarchy path, so we can match level-by-level instead of by
// exact string. Definitions are a single step keyed by their term.
export function labelToPath(label: string): PositionStep[] {
  const raw = (label ?? "").trim();
  if (!raw) return [];
  if (/^[“"']/.test(raw)) return [{ kind: "definition", label: normLabel(raw) }];
  const secMatch = raw.match(/^([0-9]+(?:\.[0-9]+)*[A-Za-z]?)/);
  const path: PositionStep[] = [];
  let rest = raw;
  if (secMatch) {
    path.push({ kind: "section", label: secMatch[1] });
    rest = raw.slice(secMatch[1].length);
  }
  const groups = rest.match(/\(([^)]+)\)/g) ?? [];
  groups.forEach((g, i) => {
    path.push({ kind: STEP_KINDS[i] ?? "clause", label: g.replace(/[()]/g, "") });
  });
  return path.length ? path : [{ kind: "section", label: normLabel(raw) }];
}

const pathOf = (p: Provision) => p.path ?? labelToPath(p.label);
const samePath = (a: PositionStep[], b: PositionStep[]) =>
  a.length === b.length && a.every((s, i) => normLabel(s.label) === normLabel(b[i].label));
const isPrefix = (pre: PositionStep[], full: PositionStep[]) =>
  pre.length <= full.length && pre.every((s, i) => normLabel(s.label) === normLabel(full[i].label));

// Find a provision by anchor label, matching level-by-level: exact path first,
// then the deepest existing ancestor (e.g. anchor 30(1)(o) → fall back to 30(1)
// → 30). Returns the match kind so the caller can route misses to the AI.
export function findByPath(
  provisions: Provision[],
  anchorLabel: string | null,
): { index: number; matched: "exact" | "ancestor" | "none"; missingDepth: number } {
  if (!anchorLabel) return { index: -1, matched: "none", missingDepth: 0 };
  const target = labelToPath(anchorLabel);
  const exact = provisions.findIndex((p) => samePath(pathOf(p), target));
  if (exact >= 0) return { index: exact, matched: "exact", missingDepth: 0 };

  // Container: the anchor names a section/subsection whose own label isn't a
  // provision because it only exists through its children (e.g. "30" -> 30(1),
  // 30(2)…). Resolve to the LAST descendant so "add after section 30" lands
  // after the whole section. This is a confident match, so report it as exact.
  let lastDesc = -1;
  for (let i = 0; i < provisions.length; i++) {
    if (isPrefix(target, pathOf(provisions[i]))) lastDesc = i;
  }
  if (lastDesc >= 0) return { index: lastDesc, matched: "exact", missingDepth: 0 };

  // Deepest ancestor: longest target prefix that exists as a provision path.
  let best = -1, bestLen = 0;
  for (let i = 0; i < provisions.length; i++) {
    const pp = pathOf(provisions[i]);
    if (pp.length < target.length && isPrefix(pp, target) && pp.length > bestLen) {
      best = i;
      bestLen = pp.length;
    }
  }
  if (best >= 0) return { index: best, matched: "ancestor", missingDepth: target.length - bestLen };
  return { index: -1, matched: "none", missingDepth: target.length };
}

// Apply interpreted operations to the Act's provisions. Returns the resulting
// "after" provisions plus a list of operations whose anchor we couldn't verify.
export function applyAmendments(
  before: Provision[],
  ops: Amendment[],
): { after: Provision[]; verified: Array<Amendment & { anchorFound: boolean }> } {
  const after: Provision[] = before.map((p) => ({ ...p }));
  const verified: Array<Amendment & { anchorFound: boolean }> = [];
  const indexOfLabel = (label: string | null) => {
    if (!label) return -1;
    const want = normLabel(label);
    return after.findIndex((p) => normLabel(p.label) === want);
  };

  for (const op of ops) {
    const i = indexOfLabel(op.anchor);
    const anchorFound = i >= 0 || (op.op === "add" && !op.anchor);
    verified.push({ ...op, anchorFound });

    if (op.op === "repeal") {
      if (i >= 0) after.splice(i, 1);
    } else if (op.op === "replace") {
      if (i >= 0) {
        after[i] = {
          ...after[i],
          marginalNote: op.newMarginalNote ?? after[i].marginalNote,
          text: op.newText ?? after[i].text,
        };
      }
    } else if (op.op === "amend") {
      if (i >= 0 && op.newText) after[i] = { ...after[i], text: op.newText };
    } else {
      // add — insert a new provision near the anchor (or append if no anchor).
      const newP: Provision = {
        id: `new:${op.newLabel || op.anchor || verified.length}`,
        label: op.newLabel || "(new)",
        kind: "section",
        heading: i >= 0 ? after[i].heading ?? null : null,
        marginalNote: op.newMarginalNote || null,
        text: op.newText || "",
      };
      const at = i < 0 ? after.length : op.position === "before" ? i : i + 1;
      after.splice(at, 0, newP);
    }
  }
  return { after, verified };
}

// Diff before/after by provision identity (stable id), falling back to label.
export function diffProvisions(before: Provision[], after: Provision[]): DiffRow[] {
  const key = (p: Provision) =>
    p.id && !p.id.startsWith("new:") ? `id:${p.id}` : `lbl:${normLabel(p.label)}`;
  const beforeMap = new Map(before.map((p) => [key(p), p]));
  const afterMap = new Map(after.map((p) => [key(p), p]));
  const rows: DiffRow[] = [];

  for (const p of after) {
    const b = beforeMap.get(key(p));
    if (!b) {
      rows.push({ status: "added", label: p.label, after: p });
    } else if (squish(b.text) === squish(p.text) && (b.marginalNote ?? "") === (p.marginalNote ?? "")) {
      rows.push({ status: "unchanged", label: p.label, before: b, after: p });
    } else {
      rows.push({ status: "changed", label: p.label, before: b, after: p });
    }
  }
  for (const p of before) {
    if (!afterMap.has(key(p))) rows.push({ status: "repealed", label: p.label, before: p });
  }
  return rows;
}

export function diffSummary(rows: DiffRow[]) {
  return {
    added: rows.filter((r) => r.status === "added").length,
    changed: rows.filter((r) => r.status === "changed").length,
    repealed: rows.filter((r) => r.status === "repealed").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
  };
}
