import type {
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";
import { FILES, readAll, writeAll } from "../services/jsonStore.js";
import {
  buildSeedLawVersion,
  CANNED_IMPACTS,
  loadBillLawLinks,
  loadTeammateBaseLaws,
  loadTeammateBills,
  loadTeammateClients,
} from "../services/seedSource.js";

const HEADLINING_BILL_NUMBER = "S-202";
const HEADLINING_LAW_SLUG = "food-and-drugs-act";

interface SeedSnapshot {
  bills: Bill[];
  baseLaws: BaseLaw[];
  lawVersions: LawVersion[];
  clients: Client[];
  billLawLinks: Awaited<ReturnType<typeof loadBillLawLinks>>;
}

let CACHED: SeedSnapshot | null = null;

export async function loadSeedSnapshot(): Promise<SeedSnapshot> {
  if (CACHED) return CACHED;

  const [bills, baseLaws, clients, billLawLinks] = await Promise.all([
    loadTeammateBills(),
    loadTeammateBaseLaws(),
    loadTeammateClients(),
    loadBillLawLinks(),
  ]);

  const lawVersions: LawVersion[] = [];
  const seenPair = new Set<string>();
  const pushPair = (bill: Bill | undefined, baseLaw: BaseLaw | undefined) => {
    if (!bill || !baseLaw) return;
    const key = `${bill.billNumber}|${baseLaw.id}`;
    if (seenPair.has(key)) return;
    const lv = buildSeedLawVersion({ bill, baseLaw });
    if (!lv) return;
    seenPair.add(key);
    lawVersions.push(lv);
  };

  // Seed the headlining S-202 × Food and Drugs Act pair first (kept as the
  // canonical demo entry point even though billLawLinks would also produce it).
  pushPair(
    bills.find((b) => b.billNumber === HEADLINING_BILL_NUMBER),
    baseLaws.find((l) => l.id === HEADLINING_LAW_SLUG),
  );

  // Seed every (bill, law) pair declared in bill-law-links for which a canned
  // diff exists in CANNED_DIFFS. Pairs without a canned diff fall through to
  // the live Gemini path at extract-delta time.
  for (const link of billLawLinks) {
    pushPair(
      bills.find((b) => b.billNumber === link.bill),
      baseLaws.find((l) => l.id === link.lawSlug),
    );
  }

  CACHED = { bills, baseLaws, lawVersions, clients, billLawLinks };
  return CACHED;
}

export async function seedDemo() {
  const snap = await loadSeedSnapshot();

  const bills = await readAll(FILES.bills);
  if (bills.length === 0) await writeAll(FILES.bills, snap.bills);

  const baseLaws = await readAll(FILES.baseLaws);
  if (baseLaws.length === 0) await writeAll(FILES.baseLaws, snap.baseLaws);

  const lvs = await readAll(FILES.lawVersions);
  if (lvs.length === 0) await writeAll(FILES.lawVersions, snap.lawVersions);

  const clients = await readAll(FILES.clients);
  if (clients.length === 0) await writeAll(FILES.clients, snap.clients);
}

/**
 * Look up a canned impact analysis for the (client, bill) pair.
 *
 * Canned impacts are keyed by `${clientId}|${billNumber}` because a single
 * client may have a different impact analysis per bill (e.g. EventPour for
 * S-202 vs Bayer for C-273). Returning null means the route should fall
 * through to the live Gemini call.
 */
export function findCannedImpact(args: {
  clientId: string;
  lawVersion: LawVersion;
}): Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "lawVersionId" | "saved" | "createdAt"
> | null {
  const key = `${args.clientId}|${args.lawVersion.sourceBillNumber}`;
  return CANNED_IMPACTS[key] ?? null;
}

export async function findBaseLawForBill(billId: string): Promise<BaseLaw | null> {
  const snap = await loadSeedSnapshot();
  const billNumber = snap.bills.find((b) => b.id === billId)?.billNumber;
  if (!billNumber) return null;
  const link = snap.billLawLinks.find((l) => l.bill === billNumber);
  if (!link) return null;
  return snap.baseLaws.find((bl) => bl.id === link.lawSlug) ?? null;
}
