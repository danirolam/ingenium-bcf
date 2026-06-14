/**
 * EVAL fixture seeder — makes the 5 benchmark bills scan-ready and upserts the 7
 * eval clients. Run from the repo root:  npx tsx eval/seed-eval.ts
 *
 * Writes (idempotent — replaces its own records on re-run):
 *   server/data/provisionDeltas.json  ← deterministically-authored stage-1/2 delta
 *     for each of the 5 bills (fixtures/bill-deltas.ts). __evalSeed.
 *   server/data/approvals.json         ← every authored operation approved. __evalSeed.
 *   server/data/clients.json           ← upserts the 7 eval clients (input-only;
 *     fixtures/clients.ts). Running THIS seeder is what populates the 7 into the
 *     committed clients.json — they are not hand-maintained there.
 *
 * provisionDeltas.json / approvals.json are gitignored runtime state — re-run after
 * any data reset. The eval clients survive the e2e teardown via PROTECTED_CLIENT_IDS
 * in e2e/seed.ts. Mirrors the atomic read/write + id-upsert pattern of e2e/seed-demo.ts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_BILLS } from "./fixtures/bill-deltas.js";
import { EVAL_CLIENTS } from "./fixtures/clients.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "server", "data");
const DELTAS_FILE = path.join(DATA, "provisionDeltas.json");
const APPROVALS_FILE = path.join(DATA, "approvals.json");
const CLIENTS_FILE = path.join(DATA, "clients.json");

// Missing file = empty store; corrupt JSON / permission errors MUST throw — never
// silently clobber the real stage-1/2 cache or the committed client roster.
async function readArray<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}
// Atomic write (temp + rename), mirroring jsonStore — a crash mid-write must never
// leave a half-written store behind.
async function writeArray(file: string, items: unknown[]): Promise<void> {
  const tmp = `${file}.${process.pid}.eval.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function main(): Promise<void> {
  const billIds = new Set(EVAL_BILLS.map((b) => b.billId));
  const clientIds = new Set(EVAL_CLIENTS.map((c) => c.id));

  // provisionDeltas.json — replace our bills' records, keep everything else.
  const deltas = await readArray<{ id: string }>(DELTAS_FILE);
  await writeArray(DELTAS_FILE, [
    ...deltas.filter((r) => !billIds.has(r.id)),
    ...EVAL_BILLS.map((b) => b.delta),
  ]);

  // approvals.json — replace our bills' records, keep everything else.
  const approvals = await readArray<{ id: string }>(APPROVALS_FILE);
  await writeArray(APPROVALS_FILE, [
    ...approvals.filter((r) => !billIds.has(r.id)),
    ...EVAL_BILLS.map((b) => b.approval),
  ]);

  // clients.json — upsert the 7 eval clients by id (existing roster untouched).
  const clients = await readArray<{ id: string }>(CLIENTS_FILE);
  await writeArray(CLIENTS_FILE, [
    ...clients.filter((c) => !clientIds.has(c.id)),
    ...EVAL_CLIENTS,
  ]);

  const ops = EVAL_BILLS.reduce((n, b) => n + b.approval.keys.length, 0);
  console.log(
    `[eval seed] ${EVAL_BILLS.length} bills scan-ready (${ops} approved ops): ` +
      `${EVAL_BILLS.map((b) => b.billNumber).join(", ")}.\n` +
      `[eval seed] clients upserted: ${EVAL_CLIENTS.map((c) => c.id).join(", ")}.`,
  );
}

main().catch((err) => {
  console.error("[eval seed] failed:", err);
  process.exitCode = 1;
});
