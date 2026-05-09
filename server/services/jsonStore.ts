import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

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
    throw err;
  }
}

export async function writeAll<T>(file: string, items: T[]): Promise<void> {
  await ensureDir();
  const p = path.join(DATA_DIR, file);
  await fs.writeFile(p, JSON.stringify(items, null, 2), "utf-8");
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

export const FILES = {
  bills: "bills.json",
  lawVersions: "lawVersions.json",
  clients: "clients.json",
  impacts: "clientImpactAnalyses.json",
  baseLaws: "baseLaws.json",
};
