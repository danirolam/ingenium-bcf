// Durable bills snapshot in Vercel Blob. A live refresh writes the full bills
// array here; on a Vercel cold start the app overlays the committed snapshot
// with it, so the deployed site serves the latest refreshed bills (the /tmp
// store is ephemeral). Mirrors the Acts-corpus pattern (upload-acts-blob.mjs +
// lawProvisions Blob read): a committed manifest holds the stable public URL.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";
import type { Bill } from "../../src/types.js";
import { writeAll, FILES } from "./jsonStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(REPO_ROOT, "data", "bills-blob-manifest.json");
// Stable Blob pathname (no random suffix) so every write overwrites the same
// public URL — the committed manifest stays valid across runtime refreshes.
const BLOB_PATH = "bills/bills.json";

interface BillsBlobManifest {
  url: string;
  uploadedAt: string;
  count: number;
}

export async function readBillsManifest(): Promise<BillsBlobManifest | null> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, "utf-8")) as BillsBlobManifest;
  } catch {
    return null;
  }
}

// Write the full bills array to Blob (overwrite). Returns the public URL.
// Refreshes the committed manifest when the filesystem is writable (dev/seed);
// on Vercel that write no-ops and the stable URL keeps the committed manifest valid.
export async function writeBillsBlob(bills: Bill[]): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set — cannot persist bills to Blob");
  const res = await put(BLOB_PATH, JSON.stringify(bills), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  try {
    const manifest: BillsBlobManifest = { url: res.url, uploadedAt: new Date().toISOString(), count: bills.length };
    await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch {
    /* read-only fs (Vercel) — the committed manifest already holds the stable URL */
  }
  return res.url;
}

// Read the bills array from Blob via the manifest's public URL (no token needed
// for a public read). null when not yet seeded or unreachable.
export async function readBillsBlob(): Promise<Bill[] | null> {
  const man = await readBillsManifest();
  if (!man?.url) return null;
  try {
    const res = await fetch(man.url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data.length ? (data as Bill[]) : null;
  } catch {
    return null;
  }
}

// On startup, make the Blob snapshot the store's bills if one exists. Vercel-only:
// locally the committed server/data/bills.json is the working source (and a local
// refresh writes it directly). Safe no-op when nothing is seeded in Blob.
export async function overlayBillsFromBlob(): Promise<void> {
  if (!process.env.VERCEL) return;
  const bills = await readBillsBlob();
  if (bills) {
    await writeAll(FILES.bills, bills);
    console.log(`[billsBlob] overlaid ${bills.length} bills from Blob`);
  }
}
