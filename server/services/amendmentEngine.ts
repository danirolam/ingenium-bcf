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

// NOTE: provision location is no longer done here. The AI locator returns an
// ancestor path verified against the real Act tree (see amendmentLocator.ts), and
// amendmentApply.ts mutates the tree + re-flattens. This module now only owns the
// before/after DIFF and op→row linking below.

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

const SLIM_TEXT_THRESHOLD = 6_000_000; // total before+after chars above which we slim
const SLIM_WINDOW = 12; // keep full text ±this around each produced row (UI's BASE is 10)

// For a huge Act (e.g. the Income Tax Act), blank the text of unchanged provisions
// that are far from any change, so the response payload stays manageable. The ops'
// producedRowIndices/contextRowIndices (from attachRowLinks) mark what to keep in
// full; changed/added/repealed rows are always kept by status. Display-only.
export function slimUnchangedText(rows: DiffRow[], ops: ReadonlyArray<unknown>): DiffRow[] {
  let total = 0;
  for (const r of rows) total += (r.before?.text?.length ?? 0) + (r.after?.text?.length ?? 0);
  if (total <= SLIM_TEXT_THRESHOLD) return rows; // normal Act — untouched

  const keep = new Set<number>();
  for (const op of ops as ReadonlyArray<{ producedRowIndices?: number[]; contextRowIndices?: number[] }>) {
    for (const i of op.contextRowIndices ?? []) keep.add(i);
    for (const pi of op.producedRowIndices ?? []) {
      for (let j = pi - SLIM_WINDOW; j <= pi + SLIM_WINDOW; j++) {
        if (j >= 0 && j < rows.length) keep.add(j);
      }
    }
  }
  const blank = (p?: Provision): Provision | undefined => (p ? { ...p, text: "" } : p);
  return rows.map((r, i) =>
    r.status === "unchanged" && !keep.has(i) ? { ...r, before: blank(r.before), after: blank(r.after) } : r,
  );
}
