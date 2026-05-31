// Load the structured (provision-level) text of a registered Act, produced by
// scripts/ingest-acts.mjs. This is the "before" anchor for the grounded delta.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { labelToPath, type Provision } from "./amendmentEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export interface ActProvisions {
  slug: string;
  title: string;
  citation: string;
  provisions: Provision[];
}

export async function loadActProvisions(slug: string): Promise<ActProvisions | null> {
  try {
    const p = path.join(
      REPO_ROOT,
      "data/laws/current/federal",
      slug,
      "current.normalized.json",
    );
    const j = JSON.parse(await fs.readFile(p, "utf8"));
    if (!Array.isArray(j.provisions) || j.provisions.length === 0) return null;
    // Attach a structured position to each provision for level-by-level matching.
    const provisions: Provision[] = j.provisions.map((p: Provision) => ({
      ...p,
      path: p.path ?? labelToPath(p.label),
    }));
    return { slug, title: j.title, citation: j.citation, provisions };
  } catch {
    return null;
  }
}
