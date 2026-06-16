// Apply located operations to an Act, deterministically. Each op carries an
// ancestor path the locator already verified; we mutate a CLONE of the Act tree
// (insert / replace / repeal / amend) and re-flatten, so document order falls out
// of the tree itself — no index juggling. The before/after leaf lists then feed
// the unchanged diffProvisions → attachRowLinks pipeline.
//
// The AI never reaches here: inserted/replacement text comes from the bill's
// <AmendedText> (the `inserts` subtree); an amend's new text comes from the
// grounded scalpel (the route fills `editedText`).
import { compareLabels, emitsRow, flattenActTree, normSeg, type ActNode, type ActTree } from "./lawTree.js";
import type { PositionStep, Provision } from "./amendmentEngine.js";

export interface ApplyOp {
  clause: string;
  op: "add" | "replace" | "amend" | "repeal";
  ancestors: PositionStep[];
  instruction: string;
  confirmed: boolean;
  inserts: ActNode[]; // bill-parsed content for add/replace
  editedText?: string; // amend: full edited text from the grounded scalpel
}

// Mirrors VerifiedOp from the old engine so attachRowLinks can resolve producedKeys
// → row indices unchanged.
export interface AppliedOp {
  clause: string;
  op: ApplyOp["op"];
  ancestors: PositionStep[];
  instruction: string;
  confirmed: boolean;
  located: boolean;
  producedKeys: string[];
}

// Ids of the nodes in a subtree that flattenActTree emits as provisions (same
// predicate, so produced-row linking lines up with the diff rows exactly).
function textIds(node: ActNode, out: string[] = []): string[] {
  if (emitsRow(node)) out.push(node.id);
  for (const c of node.children ?? []) textIds(c, out);
  return out;
}

// Walk the (mutable) tree by label, returning the matched node, its sibling array,
// and index — so we can splice. Ensures each traversed node has a children array.
function locate(roots: ActNode[], ancestors: PositionStep[]): { siblings: ActNode[]; index: number; node: ActNode } | null {
  let level = roots;
  let found: { siblings: ActNode[]; index: number; node: ActNode } | null = null;
  for (const step of ancestors) {
    const want = normSeg(step.label);
    const idx = level.findIndex((n) => normSeg(n.num) === want);
    if (idx < 0) return null;
    const node = level[idx];
    found = { siblings: level, index: idx, node };
    level = node.children ?? (node.children = []);
  }
  return found;
}

// provKey format (mirrors amendmentEngine.provKey for an id-bearing provision).
const keyOf = (id: string) => `id:${id}`;

export function applyOperations(
  tree: ActTree,
  ops: ApplyOp[],
): { before: Provision[]; after: Provision[]; applied: AppliedOp[] } {
  const before = flattenActTree(tree);
  const clone: ActTree = structuredClone(tree);
  let serial = 0;
  const restamp = (nodes: ActNode[]): ActNode[] =>
    nodes.map((n) => ({ ...n, id: `ins:${serial++}`, children: n.children ? restamp(n.children) : [] }));

  // Insert nodes into a sibling array at the position the comparator dictates.
  const sortIn = (arr: ActNode[], ins: ActNode[]) => {
    // Sort by the first NUMBERED insert — a leading heading node (num "") is decoration
    // and carries no sort position; it rides along with the section it precedes.
    const anchor = ins.find((n) => n.num) ?? ins[0];
    const key = anchor.num, kind = anchor.kind;
    let pos = arr.length;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].kind === kind && compareLabels(kind, arr[i].num, key) > 0) { pos = i; break; }
    }
    arr.splice(pos, 0, ...ins);
  };

  const applied: AppliedOp[] = [];
  for (const op of ops) {
    const base: AppliedOp = {
      clause: op.clause, op: op.op, ancestors: op.ancestors, instruction: op.instruction,
      confirmed: op.confirmed, located: false, producedKeys: [],
    };
    // Schedule-targeted ops mutate the schedule tree; everything else the body tree.
    const roots = op.ancestors[0] && clone.schedules.some((s) => normSeg(s.num) === normSeg(op.ancestors[0].label))
      ? clone.schedules
      : clone.sections;

    if (op.op === "add") {
      const parentAnc = op.ancestors.slice(0, -1);
      let arr: ActNode[];
      if (!parentAnc.length) arr = roots;
      else {
        const p = locate(roots, parentAnc);
        if (!p) { applied.push(base); continue; }
        arr = p.node.children ?? (p.node.children = []);
      }
      const ins = restamp(op.inserts);
      if (!ins.length) { applied.push(base); continue; }
      sortIn(arr, ins);
      base.located = true;
      base.producedKeys = ins.flatMap((n) => textIds(n)).map(keyOf);
    } else {
      const hit = locate(roots, op.ancestors);
      if (!hit) { applied.push(base); continue; }
      if (op.op === "repeal") {
        const ids = textIds(hit.node);
        hit.siblings.splice(hit.index, 1);
        base.located = true;
        base.producedKeys = ids.map(keyOf);
      } else if (op.op === "replace") {
        const ins = restamp(op.inserts);
        // A replace may cover a RENUMBERED RANGE ("(b) to (c)"): the inserts are
        // the new state of that span, so also drop any other sibling whose label
        // the inserts reintroduce — otherwise the old row survives as a duplicate.
        const insLabels = new Set(ins.map((n) => normSeg(n.num)));
        const remove = new Set<number>([hit.index]);
        const oldIds = textIds(hit.node);
        hit.siblings.forEach((s, i) => {
          if (i !== hit.index && insLabels.has(normSeg(s.num))) { remove.add(i); textIds(s, oldIds); }
        });
        const insertAt = hit.index - [...remove].filter((i) => i < hit.index).length;
        for (const i of [...remove].sort((a, b) => b - a)) hit.siblings.splice(i, 1);
        hit.siblings.splice(insertAt, 0, ...ins);
        base.located = true;
        base.producedKeys = [...oldIds, ...ins.flatMap((n) => textIds(n))].map(keyOf);
      } else {
        // amend — in-place text edit; the scalpel already produced the full text.
        if (op.editedText != null) hit.node.text = op.editedText;
        base.located = true;
        base.producedKeys = [keyOf(hit.node.id)];
      }
    }
    applied.push(base);
  }

  const after = flattenActTree(clone);
  return { before, after, applied };
}
