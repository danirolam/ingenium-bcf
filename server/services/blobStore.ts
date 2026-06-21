// Durable cross-instance persistence for the mutable runtime stores via Vercel
// Blob. On Vercel each function instance has its own ephemeral /tmp, so a brief
// generated (or a delta computed, or an op approved) on one instance vanishes
// when the next request lands on a cold instance. Here the small stores (briefs,
// approvals, scans) are READ-THROUGH Blob so every instance sees the latest, and
// the large provisionDeltas cache is write-through + hydrated on cold start.
//
// Local dev and the keyless e2e suite have no VERCEL env / no token, so this is
// a complete no-op there and every store stays plain-file as before.
import { put, list } from "@vercel/blob";

// Mutable stores persisted to Blob on every write (write-through).
const DURABLE = new Set([
  "clientImpactAnalyses.json",
  "approvals.json",
  "clientScans.json",
  "provisionDeltas.json",
]);
// Small stores ALSO read from Blob on every read (always fresh, cheap). The
// large provisionDeltas cache is hydrated on cold start instead of per read.
const READ_THROUGH = new Set([
  "clientImpactAnalyses.json",
  "approvals.json",
  "clientScans.json",
]);

/** The full set of durable files, for cold-start hydration. */
export const DURABLE_FILES = [...DURABLE];

function token(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}
function enabled(): boolean {
  return Boolean(process.env.VERCEL && token());
}
export function isDurable(file: string): boolean {
  return enabled() && DURABLE.has(file);
}
export function isReadThrough(file: string): boolean {
  return enabled() && READ_THROUGH.has(file);
}

const blobPath = (file: string) => `runtime/${file}`;

/** Persist a store's full JSON to Blob (overwrite, no CDN caching). Best-effort. */
export async function blobWrite(file: string, data: string): Promise<void> {
  if (!enabled() || !DURABLE.has(file)) return;
  try {
    await put(blobPath(file), data, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
      token: token(),
    });
  } catch (err) {
    console.warn(`[blobStore] write ${file} failed:`, (err as Error)?.message);
  }
}

/** Read a store's full JSON from Blob, or null when absent/unreachable. The
 *  cache-busting query + no-store fetch defeat any edge caching, so a read right
 *  after a write returns the fresh bytes. */
export async function blobRead(file: string): Promise<string | null> {
  if (!enabled() || !DURABLE.has(file)) return null;
  try {
    const { blobs } = await list({ prefix: blobPath(file), limit: 1, token: token() });
    const found = blobs.find((b) => b.pathname === blobPath(file)) ?? blobs[0];
    if (!found?.url) return null;
    const sep = found.url.includes("?") ? "&" : "?";
    const res = await fetch(`${found.url}${sep}_=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn(`[blobStore] read ${file} failed:`, (err as Error)?.message);
    return null;
  }
}
