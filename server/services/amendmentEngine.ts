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

// Stable identity key for diffing and op→row linking. Every provision carries a
// unique id (real lims id for the Act; a fresh "ins:N" for bill-inserted ones, see
// applyGroups/applyAmendments), so keying by id is both stable and collision-free.
// One definition used everywhere so keys never disagree.
export const provKey = (p: Provision) =>
  p.id ? `id:${p.id}` : `lbl:${normLabel(p.label)}`;

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

// Every provision that falls under an anchor: the leaf it names, OR — when the
// anchor names a container — everything inside it. A numeric anchor ("30",
// "30(1)") matches itself + its descendants by path; a "Schedule IV" anchor
// matches every provision under that schedule heading. Used by repeals, so
// "Schedule IV … is repealed" or "section 30 is repealed" removes the whole
// container instead of a single row.
export function findAllUnder(provisions: Provision[], anchorLabel: string | null): number[] {
  if (!anchorLabel) return [];
  if (/^\s*schedule\b/i.test(anchorLabel)) {
    const want = normLabel(anchorLabel); // "Schedule IV" → "scheduleiv"
    return provisions.flatMap((p, i) => (normLabel(p.heading ?? "") === want ? [i] : []));
  }
  const target = labelToPath(anchorLabel);
  const out: number[] = [];
  provisions.forEach((p, i) => {
    const pp = pathOf(p);
    if (samePath(pp, target) || isPrefix(target, pp)) out.push(i);
  });
  return out;
}

// Apply interpreted operations to the Act's provisions. Returns the resulting
// "after" provisions plus a list of operations whose anchor we couldn't verify.
export type VerifiedOp = Amendment & {
  anchorFound: boolean;
  /** Identity keys of the provisions this op produced (added/changed/repealed),
   *  resolved to row indices by attachRowLinks. */
  producedKeys: string[];
  /** Full human-readable instruction ("Bill says"). */
  instruction: string;
  /** How this op was resolved: "structured" (deterministic from the bill XML) or
   *  "ai" (the AI scalpel/interpreter). Per-op, so a mixed delta tags each card. */
  resolution: "structured" | "ai";
};

export function applyAmendments(
  before: Provision[],
  ops: Amendment[],
): { after: Provision[]; verified: VerifiedOp[] } {
  const after: Provision[] = before.map((p) => ({ ...p }));
  const verified: VerifiedOp[] = [];
  let serial = 0; // unique ids for inserted provisions (so provKey distinguishes them)
  const indexOfLabel = (label: string | null) => {
    if (!label) return -1;
    const want = normLabel(label);
    return after.findIndex((p) => normLabel(p.label) === want);
  };

  for (const op of ops) {
    const i = indexOfLabel(op.anchor);
    const anchorFound = i >= 0 || (op.op === "add" && !op.anchor);
    let producedKeys: string[] = [];

    if (op.op === "repeal") {
      if (i >= 0) { producedKeys = [provKey(after[i])]; after.splice(i, 1); }
    } else if (op.op === "replace") {
      if (i >= 0) {
        after[i] = {
          ...after[i],
          marginalNote: op.newMarginalNote ?? after[i].marginalNote,
          text: op.newText ?? after[i].text,
        };
        producedKeys = [provKey(after[i])];
      }
    } else if (op.op === "amend") {
      if (i >= 0) {
        if (op.newText) after[i] = { ...after[i], text: op.newText };
        producedKeys = [provKey(after[i])];
      }
    } else {
      // add — insert a new provision near the anchor (or append if no anchor).
      const newLabel = op.newLabel || "(new)";
      const newPath = labelToPath(newLabel);
      const newP: Provision = {
        id: `ins:${serial++}`,
        label: newLabel,
        kind: newPath[newPath.length - 1]?.kind ?? "section",
        heading: i >= 0 ? after[i].heading ?? null : null,
        marginalNote: op.newMarginalNote || null,
        text: op.newText || "",
        path: newPath,
      };
      const at = i < 0 ? after.length : op.position === "before" ? i : i + 1;
      after.splice(at, 0, newP);
      producedKeys = [provKey(newP)];
    }
    verified.push({ ...op, anchorFound, producedKeys, instruction: op.note ?? "", resolution: "ai" });
  }
  return { after, verified };
}

// Diff before/after into rows in DOCUMENT ORDER (repealed rows interleaved at
// their original position, not appended at the end), keyed by provKey. The
// document-order guarantee lets a caller window ±N rows around any change.
export function diffProvisions(before: Provision[], after: Provision[]): DiffRow[] {
  const beforeKeys = before.map(provKey);
  const beforeByKey = new Map(before.map((p) => [provKey(p), p] as const));
  const afterKeys = new Set(after.map(provKey));
  const rows: DiffRow[] = [];

  // Emit repealed (in `before`, absent from `after`) up to a before-index.
  let bi = 0;
  const flushRepealedUpTo = (limit: number) => {
    while (bi < limit) {
      if (!afterKeys.has(beforeKeys[bi])) {
        rows.push({ status: "repealed", label: before[bi].label, before: before[bi] });
      }
      bi++;
    }
  };

  for (const a of after) {
    const ak = provKey(a);
    const b = beforeByKey.get(ak);
    if (!b) {
      rows.push({ status: "added", label: a.label, after: a });
      continue;
    }
    // Flush any repealed provisions that originally preceded this survivor.
    const bIdx = beforeKeys.indexOf(ak, bi);
    if (bIdx >= 0) { flushRepealedUpTo(bIdx); bi = bIdx + 1; }
    if (squish(b.text) === squish(a.text) && (b.marginalNote ?? "") === (a.marginalNote ?? "")) {
      rows.push({ status: "unchanged", label: a.label, before: b, after: a });
    } else {
      rows.push({ status: "changed", label: a.label, before: b, after: a });
    }
  }
  flushRepealedUpTo(before.length); // trailing repeals (e.g. end-of-Act)
  return rows;
}

// Resolve each op's produced provisions to indices into `rows` and a ±contextN
// document-order window, and stamp the stable approval `key` ("<slug>#<i>").
// Rows must be in document order (diffProvisions guarantees it). This is the one
// place op→row linkage is computed, so the client never re-derives it.
export function attachRowLinks<T extends { producedKeys?: string[] }>(
  slug: string,
  ops: T[],
  rows: DiffRow[],
  contextN = 5,
): Array<Omit<T, "producedKeys"> & { key: string; producedRowIndices: number[]; contextRowIndices: number[] }> {
  const keyToRow = new Map<string, number>();
  rows.forEach((r, idx) => {
    const p = r.after ?? r.before;
    if (p) { const k = provKey(p); if (!keyToRow.has(k)) keyToRow.set(k, idx); }
  });
  return ops.map((op, i) => {
    const { producedKeys, ...rest } = op as T & { producedKeys?: string[] };
    const produced = (producedKeys ?? [])
      .map((k) => keyToRow.get(k))
      .filter((n): n is number => n !== undefined)
      .sort((x, y) => x - y);
    const context: number[] = [];
    if (produced.length) {
      const lo = Math.max(0, produced[0] - contextN);
      const hi = Math.min(rows.length - 1, produced[produced.length - 1] + contextN);
      for (let j = lo; j <= hi; j++) context.push(j);
    }
    return { ...(rest as Omit<T, "producedKeys">), key: `${slug}#${i}`, producedRowIndices: produced, contextRowIndices: context };
  });
}

export function diffSummary(rows: DiffRow[]) {
  return {
    added: rows.filter((r) => r.status === "added").length,
    changed: rows.filter((r) => r.status === "changed").length,
    repealed: rows.filter((r) => r.status === "repealed").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
  };
}
