import type {
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";
import { FILES, hydrateFromSnapshot, readAll, writeAll } from "../services/jsonStore.js";
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
  const headliningBill = bills.find((b) => b.billNumber === HEADLINING_BILL_NUMBER);
  const headliningLaw = baseLaws.find((l) => l.id === HEADLINING_LAW_SLUG);
  if (headliningBill && headliningLaw) {
    lawVersions.push(
      buildSeedLawVersion({ bill: headliningBill, baseLaw: headliningLaw }),
    );
  }

  CACHED = { bills, baseLaws, lawVersions, clients, billLawLinks };
  return CACHED;
}

export async function seedDemo() {
  // On Vercel, restore the curated snapshot into /tmp before the gap-fill seed.
  await hydrateFromSnapshot();

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
 * Look up a canned impact analysis for the (clientId, lawVersionId) pair.
 * The cold demo is seeded for S-202 + Food and Drugs Act × the three demo
 * clients. Anything else returns null and the route should fall through to
 * the live Gemini call (or surface that GEMINI_API_KEY is required).
 */
export function findCannedImpact(args: {
  clientId: string;
  lawVersion: LawVersion;
}): Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "lawVersionId" | "saved" | "createdAt"
> | null {
  if (
    args.lawVersion.sourceBillNumber !== HEADLINING_BILL_NUMBER ||
    args.lawVersion.baseLawId !== HEADLINING_LAW_SLUG
  ) {
    return null;
  }
  return CANNED_IMPACTS[args.clientId] ?? null;
}

export async function findBaseLawForBill(billId: string): Promise<BaseLaw | null> {
  const snap = await loadSeedSnapshot();
  const billNumber = snap.bills.find((b) => b.id === billId)?.billNumber;
  if (!billNumber) return null;
  const link = snap.billLawLinks.find((l) => l.bill === billNumber);
  if (!link) return null;
  return snap.baseLaws.find((bl) => bl.id === link.lawSlug) ?? null;
}
