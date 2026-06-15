// Stage-2 "Delta Library" index — a read-only list of every bill that already
// has a GENERATED provision delta. The symmetric mirror of the Stage-4 brief
// index (GET /api/client-impact/briefs).
//
// Deliberately its OWN router (mounted at /api/provision-deltas) rather than an
// addition to bills.ts, so it stays clear of the parallel Stage-2 delta-comparator
// work. Read-only: it joins the three runtime stores and never writes.
import { Router } from "express";
import type { Bill, DeltaIndexEntry, ProvisionDelta } from "../../src/types.js";
import { safe } from "../services/clientScan.js";
import { FILES, readAll } from "../services/jsonStore.js";

export const deltaIndexRouter = Router();

// jsonStore arrays can carry `null` (valid JSON, so the corrupt-file self-heal
// never fires) — guard every iteration, same as the scan-ready join.
function presentOnly<T>(rows: T[]): T[] {
  return rows.filter((x) => !!x && typeof x === "object");
}

interface DeltaRecord {
  id: string; // billId
  deltas: ProvisionDelta[];
  errors?: string[];
  createdAt?: string;
}

// One readAll per store + Map lookups (mirrors GET /scan-ready's shape).
deltaIndexRouter.get(
  "/",
  safe(async (_req, res) => {
    const approvalsById = new Map(
      presentOnly(await readAll<{ id: string; keys: string[] }>(FILES.approvals)).map(
        (r) => [r.id, new Set(r.keys ?? [])] as const,
      ),
    );
    const billsById = new Map(
      presentOnly(await readAll<Bill>(FILES.bills)).map((b) => [b.id, b] as const),
    );
    const records = presentOnly(await readAll<DeltaRecord>(FILES.provisionDeltas));

    const out: DeltaIndexEntry[] = [];
    for (const rec of records) {
      const bill = billsById.get(rec.id);
      if (!bill) continue; // orphan delta (bill deleted) — skip
      const approved = approvalsById.get(rec.id) ?? new Set<string>();

      const actTitles: string[] = [];
      let opCount = 0;
      let approvedOpCount = 0;
      const summary = { added: 0, changed: 0, repealed: 0 };
      const deltas = presentOnly(rec.deltas ?? []);
      for (const delta of deltas) {
        if (delta.title) actTitles.push(delta.title);
        const ops = delta.operations ?? [];
        opCount += ops.length;
        approvedOpCount += ops.filter((op) => approved.has(op.key)).length;
        summary.added += delta.summary?.added ?? 0;
        summary.changed += delta.summary?.changed ?? 0;
        summary.repealed += delta.summary?.repealed ?? 0;
      }

      out.push({
        billId: bill.id,
        billNumber: bill.billNumber,
        billTitle: bill.title,
        billShortTitle: bill.shortTitle,
        session: bill.session,
        momentum: bill.legislativeMomentum,
        practiceAreas: bill.practiceAreas ?? [],
        actTitles,
        opCount,
        approvedOpCount,
        summary,
        source: deltas[0]?.source,
        generatedAt: rec.createdAt ?? "",
      });
    }

    out.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    res.json(out);
  }),
);
