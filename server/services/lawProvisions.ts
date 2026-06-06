// Load the structured text of a registered Act, produced by scripts/ingest-acts.mjs.
// The Act is stored as a HIERARCHICAL tree (sections → children → …); this loader
// flattens it into the engine's leaf-provision view — the "before" anchor for the
// grounded delta. The flatten is the inverse of the ingest's tree build, so the
// composed labels ("30(1)(j)") and hierarchy paths the matcher needs are derived
// here in memory and never stored.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { labelToPath, type Provision } from "./amendmentEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// One node of the stored Act tree. `num` is the provision's OWN label segment
// only ("30", "(1)", "(a)", or a definition's quoted term); the composed label
// is rebuilt by walking the tree. `text` is the chapeau; `closingText` is the
// flush after a child list; `heading` is set on top-level sections only.
export interface ActNode {
  id: string;
  num: string;
  kind: string;
  heading?: string | null;
  marginalNote?: string | null;
  text?: string;
  closingText?: string;
  children?: ActNode[];
}

export interface ActProvisions {
  slug: string;
  title: string;
  citation: string;
  provisions: Provision[];
}

// Post-order flatten of the Act tree to leaf provisions, reproducing the exact
// projection the ingester verified against the legacy parser: children before
// parents, composed labels, the section's heading pushed down to descendants,
// chapeau+closing merged, and pure-container (no-text) nodes skipped.
function flattenSections(sections: ActNode[]): Provision[] {
  const flat: Provision[] = [];
  const walk = (node: ActNode, ancestors: ActNode[]) => {
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
    const own = (node.text ?? "").trim();
    const closing = (node.closingText ?? "").trim();
    const text = [own, closing].filter(Boolean).join(" ");
    if (!text) return; // pure container — its children carry the operative text
    const chain =
      node.kind === "definition"
        ? node.num ?? ""
        : [...ancestors, node].map((n) => n.num ?? "").filter(Boolean).join("");
    const heading = ancestors.length ? ancestors[0].heading ?? null : node.heading ?? null;
    const label = chain || node.marginalNote || `¶${flat.length + 1}`;
    flat.push({
      id: node.id,
      label,
      kind: node.kind,
      heading,
      marginalNote: node.marginalNote ?? null,
      text,
      path: labelToPath(label),
    });
  };
  for (const s of sections) walk(s, []);
  return flat;
}

export async function loadActProvisions(slug: string): Promise<ActProvisions | null> {
  try {
    const p = path.join(REPO_ROOT, "data/laws/current/federal", slug, "current.normalized.json");
    const j = JSON.parse(await fs.readFile(p, "utf8"));

    let provisions: Provision[];
    if (Array.isArray(j.sections) && j.sections.length && "children" in (j.sections[0] ?? {})) {
      // Hierarchical tree (current format): flatten body + append schedules (which
      // are stored as a separate, already-flat list).
      provisions = flattenSections(j.sections as ActNode[]);
      for (const sc of (j.schedules ?? []) as Provision[]) {
        provisions.push({
          id: sc.id,
          label: sc.label,
          kind: sc.kind ?? "schedule",
          heading: sc.heading ?? null,
          marginalNote: sc.marginalNote ?? null,
          text: sc.text ?? "",
          path: labelToPath(sc.label),
        });
      }
    } else if (Array.isArray(j.provisions) && j.provisions.length) {
      // Legacy flat format (pre-tree stubs / retrieve-law.mjs) — read as-is.
      provisions = (j.provisions as Provision[]).map((pv) => ({
        ...pv,
        path: pv.path ?? labelToPath(pv.label),
      }));
    } else {
      return null;
    }

    if (provisions.length === 0) return null;
    return { slug, title: j.title, citation: j.citation, provisions };
  } catch {
    return null;
  }
}
