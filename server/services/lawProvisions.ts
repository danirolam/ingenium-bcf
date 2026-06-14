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

// ── Blob-backed corpus ─────────────────────────────────────────────────────
// The full federal corpus (~900 Acts, GBs) lives in Vercel Blob, not the
// function bundle. data/laws/blob-manifest.json (committed, written by
// scripts/upload-acts-blob.mjs) says which slugs are there and the store's
// public base URL. Local files win when present (dev + the 5 demo Acts).
let blobManifest: { baseUrl: string; acts: Record<string, number> } | null | undefined;

async function loadBlobManifest() {
  if (blobManifest !== undefined) return blobManifest;
  try {
    const p = path.join(REPO_ROOT, "data/laws/blob-manifest.json");
    blobManifest = JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    blobManifest = null;
  }
  return blobManifest;
}

// Parsed-Act cache for the warm instance: re-downloading + re-flattening a
// 20MB Act (Criminal Code) per request would dominate latency. Small cap —
// a few big Acts are fine, the whole corpus is not.
const actCache = new Map<string, ActProvisions | null>();
const ACT_CACHE_MAX = 8;

function cachePut(slug: string, value: ActProvisions | null) {
  if (actCache.size >= ACT_CACHE_MAX) {
    const oldest = actCache.keys().next().value;
    if (oldest !== undefined) actCache.delete(oldest);
  }
  actCache.set(slug, value);
}

async function readActJson(slug: string): Promise<any | null> {
  // 1. Local file (dev machine after ingest; the 5 bundled demo Acts in prod).
  try {
    const p = path.join(REPO_ROOT, "data/laws/current/federal", slug, "current.normalized.json");
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    /* fall through to Blob */
  }
  // 2. Blob (the full corpus in production).
  const manifest = await loadBlobManifest();
  if (!manifest?.baseUrl || !(slug in (manifest.acts ?? {}))) return null;
  try {
    const res = await fetch(`${manifest.baseUrl}/acts/${slug}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadActProvisions(slug: string): Promise<ActProvisions | null> {
  if (actCache.has(slug)) return actCache.get(slug) ?? null;
  try {
    const j = await readActJson(slug);
    if (!j) {
      cachePut(slug, null);
      return null;
    }

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
      cachePut(slug, null);
      return null;
    }

    if (provisions.length === 0) {
      cachePut(slug, null);
      return null;
    }
    const out: ActProvisions = { slug, title: j.title, citation: j.citation, provisions };
    cachePut(slug, out);
    return out;
  } catch {
    cachePut(slug, null);
    return null;
  }
}
