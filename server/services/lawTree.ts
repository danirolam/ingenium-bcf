// The Act as a navigable HIERARCHY. `lawProvisions.ts` flattens the ingested tree
// into a leaf list for diffing; this module keeps the tree intact so we can
// address a provision the way a citation does — by its ANCESTOR PATH
// (Act → s.30 → subsec.(1) → para.(j)) — and walk it level-by-level.
//
// This is the backbone of the new amendment locator: the AI returns an ancestor
// path, and `LawNavigator.resolve` either finds the provision or reports the
// EXACT level that failed ("section 30 exists but has no subsection (4)"), so the
// model can self-correct. Insert/replace/repeal are then applied to this tree.
import { labelToPath, normLabel, type PositionStep, type Provision } from "./amendmentEngine.js";
import { readActJson } from "./lawProvisions.js";

// One node of the stored Act tree (as produced by scripts/ingest-acts.mjs). `num`
// is the provision's OWN label segment only ("30", "(1)", "(a)", or a quoted
// definition term); the full label is composed by walking ancestors.
export interface ActNode {
  id: string;
  num: string;
  kind: string;
  heading?: string | null;
  marginalNote?: string | null;
  text?: string;
  closingText?: string;
  title?: string | null; // schedule nodes: the schedule's title
  children?: ActNode[];
}

// Bumped when the normalized format changes shape. v2 = bilingual provisions +
// structured schedules. An Act whose file predates the current version is shown
// as "outdated" in the UI until it's re-ingested.
export const CURRENT_SCHEMA = 2;

export interface ActTree {
  slug: string;
  title: string;
  citation: string;
  sections: ActNode[]; // the body hierarchy
  schedules: ActNode[]; // synthesized schedule containers (one per heading)
  schemaVersion: number;
  outdated: boolean; // file predates CURRENT_SCHEMA → re-ingest pending
}

// ── Segment normalization & the legislative comparator ──────────────────────

// Normalize a single label SEGMENT for matching: drop parentheses, quotes, and
// whitespace, lower-case. "(A)"/"a" → "a"; "(1)" → "1"; “advertisement” → the
// bare term. Keeps the dot so decimal numbering ("30.001") survives.
export const normSeg = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[“”"'() \s]/g, "").trim();

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanToInt(s: string): number | null {
  if (!/^[ivxlcdm]+$/.test(s)) return null;
  let n = 0, prev = 0;
  for (const ch of [...s].reverse()) {
    const v = ROMAN[ch];
    if (v < prev) n -= v;
    else { n += v; prev = v; }
  }
  return n;
}
const isNum = (s: string) => /^\d+$/.test(s);

// Compare one segment. The FIRST segment (a section/subsection number) is a true
// integer (so 9 < 30). Segments AFTER a dot are a DECIMAL FRACTION compared
// digit-by-digit (so .21 < .3, .01 < .1, .001 < .01) — this is the legislative
// insertion scheme: (z.2) < (z.21) < (z.3), and 30 < 30.001 < 30.01 < 30.1.
// Roman numerals only at the subparagraph level (so paragraph "(c)" stays a
// letter, not 100). Everything else is a plain string compare.
function compareSeg(a: string, b: string, kind: string, isFirst: boolean): number {
  if (isNum(a) && isNum(b)) {
    if (isFirst) return parseInt(a, 10) - parseInt(b, 10);
    const n = Math.min(a.length, b.length); // fraction: digit-lexicographic
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length - b.length; // a prefix (".9" < ".96") sorts first
  }
  if (isFirst && kind === "subparagraph") {
    const ra = romanToInt(a), rb = romanToInt(b);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// Order two sibling labels the way a statute does. Definitions sort
// alphabetically by their term; numbered/lettered provisions split on "." and
// compare segment-by-segment, where a shorter path that is a prefix sorts first
// ("30" < "30.001", "(j)" < "(j.01)", "(1)" < "(1.1)").
// NOTE: a rare corner (e.g. 21.97 vs 21.9701 coexisting) isn't perfectly ordered,
// but real Acts don't pack both, and placement is always relative to actual
// neighbors — so this is exact for every case we observe.
export function compareLabels(kind: string, a: string, b: string): number {
  if (kind === "definition" || kind === "scheduleEntry" || kind === "scheduleGroup" || kind === "scheduleItem") {
    // Alphabetical by the bare term/name — strip the curly/straight quotes first, or
    // a trailing ”/" sorts after the space in a longer term ("food" vs "food for …").
    const t = (s: string) => (s ?? "").toLowerCase().replace(/[“”"']/g, "").trim();
    const ta = t(a), tb = t(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  const A = normSeg(a).split("."), B = normSeg(b).split(".");
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const c = compareSeg(A[i], B[i], kind, i === 0);
    if (c) return c;
  }
  return A.length - B.length;
}

// ── Loading ─────────────────────────────────────────────────────────────────

// Schedules are stored as a flat list of rows, each tagged with its heading
// ("SCHEDULE A"). Group them into one synthetic container node per schedule so
// the navigator can address a whole schedule (e.g. for "Schedule IV … is
// repealed") uniformly with the section tree.
function groupSchedules(rows: ActNode[]): ActNode[] {
  const byHeading = new Map<string, ActNode>();
  for (const r of rows) {
    const heading = r.heading ?? "Schedule";
    let cont = byHeading.get(heading);
    if (!cont) {
      // "SCHEDULE A" / "Schedule IV" → the bare designator "A" / "IV" as the num.
      const num = heading.replace(/^\s*schedules?\s*/i, "").trim() || heading;
      cont = { id: `sch:${heading}`, num, kind: "schedule", heading, children: [] };
      byHeading.set(heading, cont);
    }
    cont.children!.push({ ...r, kind: "scheduleItem" });
  }
  return [...byHeading.values()];
}

export async function loadActTree(slug: string): Promise<ActTree | null> {
  try {
    // Local file first, then the Vercel Blob corpus — same source as the flattened
    // loader, so the locator reaches all ~964 Acts in production, not just the
    // 5 bundled ones.
    const j = await readActJson(slug);
    if (!j) return null;
    const sections: ActNode[] = Array.isArray(j.sections) ? j.sections : [];
    const scheduleRows: ActNode[] = Array.isArray(j.schedules) ? j.schedules : [];
    if (!sections.length && !scheduleRows.length) return null;
    const schemaVersion = typeof j.schemaVersion === "number" ? j.schemaVersion : 1;
    // v2 schedules are already a navigable tree (schedule → group → entry); v1 are
    // flat rows we group into synthetic containers.
    const v2sched = scheduleRows.some((s) => s && s.kind === "schedule" && Array.isArray(s.children));
    return {
      slug,
      title: j.title,
      citation: j.citation,
      sections,
      schedules: v2sched ? scheduleRows : groupSchedules(scheduleRows),
      schemaVersion,
      outdated: schemaVersion < CURRENT_SCHEMA,
    };
  } catch {
    return null;
  }
}

// A node becomes a row if it has its own operative text, OR it is a container
// (has children) carrying a title — so a section like 2.4 ("Classification") whose
// text lives entirely in its subsections still shows its HEADER before them. Shared
// with amendmentApply.textIds so produced-row linking stays in lock-step.
export function nodeOwnText(node: ActNode): string {
  return [(node.text ?? "").trim(), (node.closingText ?? "").trim()].filter(Boolean).join(" ");
}
export function emitsRow(node: ActNode): boolean {
  return !!nodeOwnText(node) || ((node.children?.length ?? 0) > 0 && !!(node.marginalNote || node.heading));
}

// Flatten the tree to the engine's leaf-provision view in READING order (a node
// BEFORE its children — pre-order — so a section's chapeau/header precedes its
// subsections, and a container section's title isn't dropped). Composed labels,
// top-section heading pushed down. `before` and `after` re-flatten with the same
// function, so the diff stays id-keyed and stable.
export function flattenActTree(tree: ActTree): Provision[] {
  const flat: Provision[] = [];
  const walk = (node: ActNode, ancestors: ActNode[]) => {
    const lineage = [...ancestors, node];
    if (emitsRow(node)) {
      // A definition (and anything inside it) is labelled relative to its TERM, not
      // the section number, so a paragraph under the definition "pharmacist" reads
      // "“pharmacist”(a)" rather than "21.9701“pharmacist”(a)".
      const defAt = lineage.map((n) => n.kind).lastIndexOf("definition");
      const segNodes = (defAt >= 0 ? lineage.slice(defAt) : lineage).filter((n) => n.num);
      const chain = segNodes.map((n) => n.num).join("");
      const heading = ancestors.length ? ancestors[0].heading ?? null : node.heading ?? null;
      const label = chain || node.marginalNote || `¶${flat.length + 1}`;
      // Display path built straight from the REAL tree kinds — no re-parsing the
      // composed string to guess structure. Section/definition segments stay
      // verbatim; bracketed kinds drop their parens so leafLabel re-wraps "(a)".
      const path = segNodes.map((n) => ({
        kind: n.kind,
        label: n.kind === "section" || n.kind === "definition" ? n.num : n.num.replace(/[()]/g, ""),
      }));
      flat.push({
        id: node.id,
        label,
        kind: node.kind,
        heading,
        marginalNote: node.marginalNote ?? null,
        text: nodeOwnText(node),
        path: path.length ? path : labelToPath(label),
      });
    }
    for (const child of node.children ?? []) walk(child, lineage);
  };
  for (const s of tree.sections) walk(s, []);
  // Schedules — handles both v2 (schedule → group → entry) and v1 (flat rows under
  // a synthetic container): emit each text-bearing leaf as a provision, carrying its
  // group as the marginal note and the schedule designator as the heading.
  for (const sc of tree.schedules) {
    const walkSched = (node: ActNode, group: string | null) => {
      const txt = (node.text ?? "").trim();
      if (txt && !(node.children?.length)) {
        flat.push({
          id: node.id,
          label: node.num || sc.num,
          kind: node.kind || "scheduleItem",
          heading: `Schedule ${sc.num}`,
          marginalNote: group ?? node.marginalNote ?? null,
          text: txt,
          path: [{ kind: "schedule", label: sc.num }, ...(group ? [{ kind: "scheduleGroup", label: group }] : []), { kind: node.kind || "scheduleItem", label: node.num }],
        });
        return;
      }
      const g = node.kind === "scheduleGroup" ? node.num : group;
      for (const c of node.children ?? []) walkSched(c, g);
    };
    for (const c of sc.children ?? []) walkSched(c, null);
  }
  return flat;
}

// ── Navigator ────────────────────────────────────────────────────────────────

export interface ResolveOk {
  ok: true;
  node: ActNode;
  trail: ActNode[]; // resolved ancestor nodes, root → leaf
}
export interface ResolveFail {
  ok: false;
  resolvedDepth: number; // how many ancestor steps matched before the break
  failedAt: PositionStep; // the step that didn't resolve
  reason: string; // human-readable, names the exact level that failed
  available: string[]; // sibling labels present at the failed level (to self-correct)
}
export type ResolveResult = ResolveOk | ResolveFail;

interface IndexEntry {
  node: ActNode;
  ancestors: ActNode[]; // root → parent
  label: string; // composed label
}

// Compose a node's full label from its ancestor nums (definitions are just the
// term; everything else is the concatenation, since nums already carry brackets).
function composeLabel(node: ActNode, ancestors: ActNode[]): string {
  if (node.kind === "definition") return node.num ?? "";
  return [...ancestors, node].map((n) => n.num ?? "").filter(Boolean).join("");
}

export class LawNavigator {
  readonly tree: ActTree;
  private roots: ActNode[];
  private reading: IndexEntry[] = []; // text-bearing nodes in document (pre-order) order

  constructor(tree: ActTree) {
    this.tree = tree;
    this.roots = [...tree.sections, ...tree.schedules];
    const walk = (node: ActNode, ancestors: ActNode[]) => {
      const text = [(node.text ?? "").trim(), (node.closingText ?? "").trim()].filter(Boolean).join(" ");
      if (text) this.reading.push({ node, ancestors, label: composeLabel(node, ancestors) });
      for (const c of node.children ?? []) walk(c, [...ancestors, node]);
    };
    for (const r of this.roots) walk(r, []);
  }

  // Walk the ancestor path from the Act root, failing at the exact level that
  // doesn't exist. This is what the AI's verify tool surfaces.
  resolve(ancestors: PositionStep[]): ResolveResult {
    if (!ancestors.length) return { ok: false, resolvedDepth: 0, failedAt: { kind: "act", label: this.tree.title }, reason: "empty ancestor path", available: [] };
    let level = this.roots;
    const trail: ActNode[] = [];
    for (let depth = 0; depth < ancestors.length; depth++) {
      const step = ancestors[depth];
      const want = normSeg(step.label);
      const match = level.find((n) => normSeg(n.num) === want);
      if (!match) {
        const where = depth === 0 ? this.tree.title : `${composeLabel(trail[trail.length - 1], trail.slice(0, -1))} of ${this.tree.title}`;
        return {
          ok: false,
          resolvedDepth: depth,
          failedAt: step,
          reason: `${where} has no ${step.kind || "provision"} ${step.label}`,
          available: level.map((n) => n.num).filter(Boolean),
        };
      }
      trail.push(match);
      level = match.children ?? [];
    }
    return { ok: true, node: trail[trail.length - 1], trail };
  }

  exists(ancestors: PositionStep[]): boolean {
    return this.resolve(ancestors).ok;
  }

  // The provision at an address: its text, note, where it sits, plus its children
  // and its SIBLINGS (so a range like "paragraphs (b) to (c)" is visible at a
  // glance) — or the granular failure. Doubles as the "read it back to confirm" call.
  getProvision(ancestors: PositionStep[]) {
    const r = this.resolve(ancestors);
    if (!r.ok) return { ok: false as const, error: r.reason, available: r.available };
    const n = r.node;
    const brief = (x: ActNode) => ({ label: x.num, kind: x.kind, marginalNote: x.marginalNote ?? null });
    const parent = r.trail.length >= 2 ? r.trail[r.trail.length - 2] : null;
    const siblingNodes = parent ? parent.children ?? [] : this.roots;
    return {
      ok: true as const,
      label: composeLabel(n, r.trail.slice(0, -1)),
      kind: n.kind,
      marginalNote: n.marginalNote ?? null,
      heading: n.heading ?? null,
      text: [(n.text ?? "").trim(), (n.closingText ?? "").trim()].filter(Boolean).join(" "),
      children: (n.children ?? []).map(brief),
      siblings: siblingNodes.map(brief), // includes this provision; ordered as in the Act
    };
  }

  // The children directly under an address (or the top-level sections when the
  // path is empty). Used to find the right gap for an insert, or to disambiguate.
  listChildren(ancestors: PositionStep[]) {
    let nodes: ActNode[];
    let parentLabel = this.tree.title;
    if (!ancestors.length) nodes = this.roots;
    else {
      const r = this.resolve(ancestors);
      if (!r.ok) return { ok: false as const, error: r.reason, available: r.available };
      nodes = r.node.children ?? [];
      parentLabel = composeLabel(r.node, r.trail.slice(0, -1));
    }
    return {
      ok: true as const,
      parent: parentLabel,
      children: nodes.map((c) => ({ label: c.num, kind: c.kind, marginalNote: c.marginalNote ?? null })),
    };
  }

  // A provision plus the provisions reading immediately before/after it in the
  // document — the surrounding context a lawyer would skim.
  neighbors(ancestors: PositionStep[], window = 3) {
    const r = this.resolve(ancestors);
    if (!r.ok) return { ok: false as const, error: r.reason, available: r.available };
    const idx = this.reading.findIndex((e) => e.node === r.node);
    const slice = (a: number, b: number) =>
      this.reading.slice(Math.max(0, a), b).map((e) => ({ label: e.label, marginalNote: e.node.marginalNote ?? null, snippet: snip(e.node) }));
    return {
      ok: true as const,
      before: idx > 0 ? slice(idx - window, idx) : [],
      target: { label: this.reading[idx]?.label, snippet: snip(r.node) },
      after: idx >= 0 ? slice(idx + 1, idx + 1 + window) : [],
    };
  }

  outline() {
    return this.tree.sections.map((s) => ({ label: s.num, kind: s.kind, marginalNote: s.marginalNote ?? null, heading: s.heading ?? null }));
  }

  searchText(query: string, limit = 12) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.reading
      .filter((e) => (e.node.text ?? "").toLowerCase().includes(q) || (e.node.marginalNote ?? "").toLowerCase().includes(q))
      .slice(0, limit)
      .map((e) => ({ label: e.label, marginalNote: e.node.marginalNote ?? null, snippet: snip(e.node) }));
  }

  searchMarginalNotes(query: string, limit = 12) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.reading
      .filter((e) => (e.node.marginalNote ?? "").toLowerCase().includes(q) || (e.node.heading ?? "").toLowerCase().includes(q))
      .slice(0, limit)
      .map((e) => ({ label: e.label, marginalNote: e.node.marginalNote ?? null }));
  }

  findDefinition(term: string, limit = 8) {
    const q = normSeg(term);
    return this.reading
      .filter((e) => e.node.kind === "definition" && (normSeg(e.node.num).includes(q) || q.includes(normSeg(e.node.num))))
      .slice(0, limit)
      .map((e) => ({ label: e.label, snippet: snip(e.node) }));
  }
}

const snip = (n: ActNode) => {
  const t = [(n.text ?? "").trim(), (n.closingText ?? "").trim()].filter(Boolean).join(" ");
  return t.length > 240 ? t.slice(0, 240) + "…" : t;
};

// ── Tree validity (QA) ────────────────────────────────────────────────────────

// Which child kinds legitimately nest under a parent kind. Used only to flag
// anomalies; consolidated law occasionally bends these, so this REPORTS, never
// rewrites.
const NESTS: Record<string, string[]> = {
  section: ["subsection", "paragraph", "definition", "clause"],
  subsection: ["paragraph", "definition", "clause"],
  paragraph: ["subparagraph", "clause"],
  subparagraph: ["clause"],
  definition: ["paragraph", "subparagraph"],
  schedule: ["scheduleItem"],
};

export interface TreeAnomaly {
  path: string;
  issue: string;
}

// Structural sanity check: sibling labels strictly increasing (by the
// legislative comparator), no duplicate siblings, sane kind nesting. Deliberately
// does NOT require minimal increments — gaps (2.1 → 2.4) are legitimate, left by
// repealed provisions.
export function validateActTree(tree: ActTree): TreeAnomaly[] {
  const out: TreeAnomaly[] = [];
  const walk = (node: ActNode, ancestors: ActNode[]) => {
    const here = composeLabel(node, ancestors) || node.kind;
    const kids = node.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const allowed = NESTS[node.kind];
      if (allowed && c.kind !== "section" && !allowed.includes(c.kind)) {
        out.push({ path: here, issue: `${c.kind} ${c.num} nested under ${node.kind}` });
      }
      if (i > 0 && c.kind === kids[i - 1].kind) {
        const cmp = compareLabels(c.kind, kids[i - 1].num, c.num);
        if (cmp === 0) out.push({ path: here, issue: `duplicate sibling label ${c.num}` });
        else if (cmp > 0) out.push({ path: here, issue: `siblings out of order: ${kids[i - 1].num} before ${c.num}` });
      }
      walk(c, [...ancestors, node]);
    }
  };
  for (const s of tree.sections) walk(s, []);
  return out;
}
