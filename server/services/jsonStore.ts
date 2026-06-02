import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The committed curated snapshot (162 bills, approved law versions, demo
// clients, pre-computed analyses) lives in server/data and is the store used
// locally. On Vercel the bundled filesystem is read-only except /tmp, so the
// runtime store lives there and is hydrated from the bundled snapshot on cold
// start (see hydrateFromSnapshot).
const SNAPSHOT_DIR = path.resolve(__dirname, "..", "data");
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "ingenium-data")
  : SNAPSHOT_DIR;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readAll<T>(file: string): Promise<T[]> {
  await ensureDir();
  const p = path.join(DATA_DIR, file);
  try {
    const buf = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(buf);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    // A malformed file (e.g. an interrupted legacy write) must not 500 every
    // request. Treat it as empty so the store self-heals on the next write.
    if (err instanceof SyntaxError) {
      console.warn(`[jsonStore] ${file} is corrupt (${err.message}) — treating as empty.`);
      return [];
    }
    throw err;
  }
}

// Serialize writes per file so concurrent upserts can't interleave, and write
// atomically (temp file + rename) so a reader never sees a half-written file
// and an interrupted write leaves the previous version intact.
const writeChains = new Map<string, Promise<void>>();

export async function writeAll<T>(file: string, items: T[]): Promise<void> {
  await ensureDir();
  const p = path.join(DATA_DIR, file);
  const data = JSON.stringify(items, null, 2);
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tmp, data, "utf-8");
      await fs.rename(tmp, p); // atomic on the same filesystem
    });
  writeChains.set(file, next);
  await next;
}

export async function upsert<T extends { id: string }>(
  file: string,
  item: T,
): Promise<T> {
  const items = await readAll<T>(file);
  const idx = items.findIndex((it) => it.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  await writeAll(file, items);
  return item;
}

export async function findById<T extends { id: string }>(
  file: string,
  id: string,
): Promise<T | undefined> {
  const items = await readAll<T>(file);
  return items.find((it) => it.id === id);
}

export async function removeById<T extends { id: string }>(
  file: string,
  id: string,
): Promise<boolean> {
  const items = await readAll<T>(file);
  const next = items.filter((it) => it.id !== id);
  if (next.length === items.length) return false;
  await writeAll(file, next);
  return true;
}

export const FILES = {
  bills: "bills.json",
  lawVersions: "lawVersions.json",
  clients: "clients.json",
  impacts: "clientImpactAnalyses.json",
  baseLaws: "baseLaws.json",
  provisionDeltas: "provisionDeltas.json",
  approvals: "approvals.json",
};

/**
 * On Vercel, copy the bundled committed snapshot (server/data/*.json) into the
 * writable /tmp store on a fresh cold start so production serves the same
 * curated state as local. No-op locally (where DATA_DIR already is the
 * snapshot) and for any file already present. Missing snapshot files are left
 * for seedDemo to regenerate from the data/ seed source.
 */
export async function hydrateFromSnapshot(): Promise<void> {
  if (DATA_DIR === SNAPSHOT_DIR) return;
  await ensureDir();
  for (const file of Object.values(FILES)) {
    const dest = path.join(DATA_DIR, file);
    try {
      await fs.access(dest);
      continue;
    } catch {
      /* not yet copied */
    }
    try {
      const buf = await fs.readFile(path.join(SNAPSHOT_DIR, file), "utf-8");
      await fs.writeFile(dest, buf, "utf-8");
    } catch {
      /* snapshot file absent — seedDemo will fill it from data/ */
    }
  }
}
