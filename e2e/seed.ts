/**
 * Seed / teardown for the E2E suite.
 *
 * Wired as Playwright globalSetup (default export) and globalTeardown (via
 * ./teardown.ts). Can also be run standalone for debugging:
 *
 *   npm run seed:setup      # inject the E2E records
 *   npm run seed:teardown   # remove them surgically
 *
 * What it does
 * ------------
 * SETUP
 *   1. Runs teardown first (idempotent — cleans strays from crashed runs).
 *   2. Waits for ../server/data/bills.json to exist (on a fresh clone the dev
 *      server's seedDemo() creates it at boot; Playwright starts the
 *      webServer before globalSetup runs).
 *   3. Picks two real bills deterministically: old session (not "45-1"),
 *      empty/missing clauses (metadata-only, so they collide with nothing).
 *   4. Injects a __e2eSeed-marked provision-delta record for each bill into
 *      provisionDeltas.json, and an approvals record (all 3 op keys) for the
 *      FIRST bill only into approvals.json. The second bill (delta but zero
 *      approvals) exists to assert it does NOT appear in scan-ready.
 *   5. Records state in e2e/.seed-state.json.
 *
 * TEARDOWN (surgical — never touches non-seeded records or the demo clients)
 *   - provisionDeltas.json: drop records with __e2eSeed === true.
 *   - approvals.json:       drop records whose id is a seeded bill id.
 *   - clientImpactAnalyses.json: drop analyses whose billId is a seeded bill id.
 *   - clients.json:         drop clients whose name starts with "E2E "
 *                           (the demo clients are additionally id-protected).
 *   - Files this run created that are empty again afterwards are deleted, so
 *     server/data/ is restored byte-identically.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "..", "server", "data");
const STATE_FILE = path.join(HERE, ".seed-state.json");

const BILLS_FILE = path.join(DATA_DIR, "bills.json");
const DELTAS_FILE = path.join(DATA_DIR, "provisionDeltas.json");
const APPROVALS_FILE = path.join(DATA_DIR, "approvals.json");
const IMPACTS_FILE = path.join(DATA_DIR, "clientImpactAnalyses.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

/** The three demo clients are sacred — never remove them, whatever their names. */
const PROTECTED_CLIENT_IDS = new Set([
  "client-corebloom",
  "client-northcedar-elections",
  "client-prairie-agri",
]);

// ── Seeded fixture identity (specs import these — single source of truth) ──
export const SEED_ACT = {
  slug: "e2e-test-act",
  title: "E2E Test Act",
  citation: "TEST 2026, c. 1",
} as const;
export const SECOND_ACT = {
  slug: "e2e-second-act",
  title: "E2E Second Act",
  citation: "TEST 2026, c. 2",
} as const;
export const SEED_APPROVED_KEYS = [
  `${SEED_ACT.slug}#0`,
  `${SEED_ACT.slug}#1`,
  `${SEED_ACT.slug}#2`,
] as const;

export interface SeedState {
  /** Ready bill: has a seeded delta AND all 3 ops approved. */
  billId: string;
  billNumber: string;
  title: string;
  status: string;
  session: string;
  /** Second bill: seeded delta but NO approvals — must NOT be scan-ready. */
  billId2: string;
  billNumber2: string;
  title2: string;
  deltasFileExisted: boolean;
  approvalsFileExisted: boolean;
  seededAt: string;
}

// ── Tiny structural types (kept local so e2e/ has zero coupling to src/) ──
interface BillLite {
  id: string;
  billNumber: string;
  title: string;
  status: string;
  session?: string;
  clauses?: unknown[];
  isProForma?: boolean;
}
interface DeltaRecord {
  id: string;
  __e2eSeed?: boolean;
  deltas: unknown[];
  errors: string[];
  createdAt: string;
}
interface ApprovalRecord {
  id: string;
  keys: string[];
}

// ── fs helpers (match server/services/jsonStore.ts formatting exactly) ──
async function readArray<T>(file: string): Promise<T[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err?.code === "ENOENT") return null; // file absent
    throw err;
  }
}

async function writeArray(file: string, items: unknown[]): Promise<void> {
  // Same serialization as the server's jsonStore (JSON.stringify(x, null, 2))
  // so a filtered rewrite is byte-identical for the untouched records.
  const tmp = `${file}.e2e.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

// ── The exact ProvisionDelta fixture (structure mandated by the harness spec) ──
export function buildSeedDelta(act: { slug: string; title: string; citation: string }) {
  const opKinds = ["add", "replace", "repeal"] as const;
  const rowStatuses = ["added", "changed", "repealed"] as const;

  const rows = [0, 1, 2].map((i) => {
    const status = rowStatuses[i];
    const label = String(i + 1);
    return {
      status,
      label,
      ...(status !== "added"
        ? { before: { id: `p${i}`, label, kind: "section", text: `Original text of section ${i + 1}` } }
        : {}),
      ...(status !== "repealed"
        ? { after: { id: `p${i}`, label, kind: "section", text: `Amended text of section ${i + 1}` } }
        : {}),
    };
  });

  const instructions = [
    `The ${act.title} is amended by adding the following after section 1: "1. Amended text of section 1."`,
    `Section 2 of the ${act.title} is replaced by the following: "2. Amended text of section 2."`,
    `Section 3 of the ${act.title} is repealed.`,
  ];

  const operations = [0, 1, 2].map((i) => ({
    key: `${act.slug}#${i}`,
    op: opKinds[i],
    anchor: `Section ${i + 1}`,
    position: null,
    newLabel: null,
    newMarginalNote: null,
    newText: opKinds[i] === "repeal" ? null : `Amended text of section ${i + 1}`,
    note: null,
    anchorFound: true,
    resolution: "structured",
    instruction: instructions[i],
    producedRowIndices: [i],
    contextRowIndices: [i],
  }));

  return {
    slug: act.slug,
    title: act.title,
    citation: act.citation,
    summary: { added: 1, changed: 1, repealed: 1, unchanged: 0 },
    operations,
    rows,
  };
}

// ── State file ──
export async function readSeedState(): Promise<SeedState | null> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf-8")) as SeedState;
  } catch {
    return null;
  }
}

// ── Bill selection: deterministic, old-session, metadata-only ──
function pickSeedBills(bills: BillLite[]): [BillLite, BillLite] {
  // Pro-forma C-1 bills all share one title; the flag is often absent on
  // imported records, so also sniff the title/status text.
  const isProForma = (b: BillLite) =>
    b.isProForma === true || /pro forma/i.test(b.title) || /pro forma/i.test(b.status);
  const candidates = bills
    .filter(
      (b) =>
        b.id &&
        b.billNumber &&
        b.title &&
        b.status &&
        b.session &&
        b.session !== "45-1" &&
        (!Array.isArray(b.clauses) || b.clauses.length === 0) &&
        !isProForma(b),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length < 2) {
    throw new Error(
      `[e2e seed] need 2 old-session metadata-only bills, found ${candidates.length}`,
    );
  }
  return [candidates[0], candidates[1]];
}

async function waitForBills(timeoutMs = 120_000): Promise<BillLite[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const bills = await readArray<BillLite>(BILLS_FILE);
    if (bills && bills.length > 0) return bills;
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e seed] ${BILLS_FILE} not present/non-empty after ${timeoutMs}ms — ` +
          "on a fresh clone the dev server seeds it at boot; is the webServer up?",
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Best-effort wait for the API to answer /api/health (non-fatal on timeout). */
async function waitForApi(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch("http://localhost:8787/api/health");
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      console.warn("[e2e seed] /api/health not reachable yet — proceeding (specs poll it themselves)");
      return false;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── TEARDOWN ──
export async function teardown(): Promise<void> {
  const state = await readSeedState();

  // Seeded bill ids: from the state file, plus any __e2eSeed-marked records
  // still in provisionDeltas.json (resilience when a crashed run lost state).
  const seededBillIds = new Set<string>();
  if (state) {
    seededBillIds.add(state.billId);
    seededBillIds.add(state.billId2);
  }

  // provisionDeltas.json — drop __e2eSeed records.
  //
  // Crash recovery: if .seed-state.json was lost, `state` is null. A file left
  // holding ONLY __e2eSeed records must still have been created by e2e (the
  // server never writes seed-marked records), so when the filter empties it we
  // unlink unless the state file positively says it pre-existed. Residual
  // wrinkle (documented, accepted): a crash BETWEEN the deltas and approvals
  // rewrites plus a lost state file means the next teardown can no longer
  // derive seededBillIds from deltas, so a stray approvals record for the
  // seeded bill could linger until cleaned manually.
  const deltas = await readArray<DeltaRecord>(DELTAS_FILE);
  if (deltas !== null) {
    for (const rec of deltas) if (rec.__e2eSeed) seededBillIds.add(rec.id);
    const kept = deltas.filter((rec) => !rec.__e2eSeed);
    if (kept.length !== deltas.length) {
      if (kept.length === 0 && !state?.deltasFileExisted) {
        await fs.unlink(DELTAS_FILE); // we created it; restore absence
      } else {
        await writeArray(DELTAS_FILE, kept);
      }
    }
  }

  // approvals.json — drop records for seeded bills.
  const approvals = await readArray<ApprovalRecord>(APPROVALS_FILE);
  if (approvals !== null) {
    const kept = approvals.filter((rec) => !seededBillIds.has(rec.id));
    if (kept.length !== approvals.length) {
      if (kept.length === 0 && !state?.approvalsFileExisted) {
        await fs.unlink(APPROVALS_FILE);
      } else {
        await writeArray(APPROVALS_FILE, kept);
      }
    }
  }

  // clientImpactAnalyses.json — drop analyses generated against seeded bills.
  const impacts = await readArray<{ id: string; billId?: string }>(IMPACTS_FILE);
  if (impacts !== null) {
    const kept = impacts.filter((a) => !a.billId || !seededBillIds.has(a.billId));
    if (kept.length !== impacts.length) await writeArray(IMPACTS_FILE, kept);
  }

  // clients.json — drop "E2E "-prefixed clients; demo clients are id-protected.
  const clients = await readArray<{ id: string; name?: string }>(CLIENTS_FILE);
  if (clients !== null) {
    const kept = clients.filter(
      (c) =>
        PROTECTED_CLIENT_IDS.has(c.id) ||
        typeof c.name !== "string" ||
        !c.name.startsWith("E2E "),
    );
    if (kept.length !== clients.length) await writeArray(CLIENTS_FILE, kept);
  }

  await fs.unlink(STATE_FILE).catch(() => {});
  console.log(
    `[e2e seed] teardown done${seededBillIds.size ? ` (cleaned bills: ${[...seededBillIds].join(", ")})` : " (nothing to clean)"}`,
  );
}

// ── SETUP ──
export async function setup(): Promise<SeedState> {
  await teardown(); // idempotent: clear strays from a previous crashed run

  // Fresh clone: server/data/*.json is gitignored, so bills.json only exists
  // after the dev server's seedDemo() has run. Wait for the API, then the file.
  let bills = await readArray<BillLite>(BILLS_FILE);
  if (!bills || bills.length === 0) {
    await waitForApi(); // best-effort; ordering-safe
    bills = await waitForBills();
  }
  const [bill1, bill2] = pickSeedBills(bills);

  // provisionDeltas.json — one record per seeded bill.
  const existingDeltas = await readArray<DeltaRecord>(DELTAS_FILE);
  const deltasFileExisted = existingDeltas !== null;
  const now = new Date().toISOString();
  const deltaRecords: DeltaRecord[] = [
    { id: bill1.id, __e2eSeed: true, deltas: [buildSeedDelta(SEED_ACT)], errors: [], createdAt: now },
    { id: bill2.id, __e2eSeed: true, deltas: [buildSeedDelta(SECOND_ACT)], errors: [], createdAt: now },
  ];
  await writeArray(DELTAS_FILE, [...(existingDeltas ?? []), ...deltaRecords]);

  // approvals.json — all three ops approved for bill1 ONLY.
  const existingApprovals = await readArray<ApprovalRecord>(APPROVALS_FILE);
  const approvalsFileExisted = existingApprovals !== null;
  await writeArray(APPROVALS_FILE, [
    ...(existingApprovals ?? []),
    { id: bill1.id, keys: [...SEED_APPROVED_KEYS] },
  ]);

  const state: SeedState = {
    billId: bill1.id,
    billNumber: bill1.billNumber,
    title: bill1.title,
    status: bill1.status,
    session: bill1.session ?? "",
    billId2: bill2.id,
    billNumber2: bill2.billNumber,
    title2: bill2.title,
    deltasFileExisted,
    approvalsFileExisted,
    seededAt: now,
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  console.log(
    `[e2e seed] seeded ready bill ${bill1.id} (${bill1.billNumber}, session ${bill1.session}) ` +
      `+ unapproved bill ${bill2.id} (${bill2.billNumber})`,
  );
  return state;
}

// Playwright globalSetup entrypoint.
export default async function globalSetup(): Promise<void> {
  await setup();
}

// Standalone CLI: `tsx seed.ts setup` / `tsx seed.ts teardown`.
const invokedDirectly = process.argv[1]?.endsWith("seed.ts");
if (invokedDirectly) {
  const cmd = process.argv[2];
  const run = cmd === "setup" ? setup : cmd === "teardown" ? teardown : null;
  if (!run) {
    console.error("usage: tsx seed.ts <setup|teardown>");
    process.exit(2);
  }
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
