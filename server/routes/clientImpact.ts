import { Router } from "express";
import type {
  Bill,
  Client,
  ClientImpactAnalysis,
  ProvisionDelta,
} from "../../src/types.js";
import { createAiBudget } from "../services/aiBudget.js";
import {
  SCANS_FILE,
  analyzeClientFromChanges,
  findRecord,
  loadApprovedChanges,
  safe,
  scoreClientAgainstChanges,
  withFileLock,
  type ImpactScan,
} from "../services/clientScan.js";
import {
  SCAN_BANDS,
  type ScanBand,
  type ScanReadyBill,
  type ScanReadyDetail,
  type ScoreBody,
} from "../services/clientScanCore.js";
import { sendClientImpactCompleteEmail } from "../services/email.js";
import { billAffectedActs } from "../services/gemini.js";
import { flagImpactReview } from "../services/humanReview.js";
import { FILES, readAll, upsert, writeAll } from "../services/jsonStore.js";
import { findCannedImpact } from "../seed/seedDemo.js";

export const clientImpactRouter = Router();

// Keep only this many analyses per (client, bill) pair — every /analyze
// re-run adds one, and unbounded history bloats the store.
const MAX_HISTORY_PER_PAIR = 3;

// jsonStore arrays can carry `null` (or other non-object) elements — valid
// JSON, so the corrupt-file self-heal never fires. Guard every iteration.
function presentOnly<T>(rows: T[]): T[] {
  return rows.filter((x) => !!x && typeof x === "object");
}

// Generic synthesized fallback — keeps the app usable without an AI key
// for any (client, bill) pair. Extracted verbatim from the old inline path.
function synthesizeFallback(bill: Bill, client: Client): ClientImpactAnalysis {
  const acts = billAffectedActs(bill);
  const actName = acts[0] ?? "the affected legislation";
  const actList = acts.join(", ") || "the affected provisions";
  return {
    id: "",
    clientId: client.id,
    billId: bill.id,
    affected: "unclear",
    impactLevel: "medium",
    urgency: "medium",
    timing: `${bill.billNumber} is currently at: ${bill.status}. It is not law — if it were enacted, coming-into-force timing would depend on the final text and any transition provisions.`,
    whyItAffectsClient: `${client.name} operates in ${client.industry} across ${client.jurisdictions.join(", ")}. ${bill.billNumber} (which would amend ${actList}) may touch areas of the client's operations; counsel review would be needed to confirm scope and magnitude before anything is communicated as definitive.`,
    affectedClientAreas: [
      "Contractual terms",
      "Operational compliance",
      "Disclosure / labelling",
    ],
    requiredAdaptations: [
      {
        area: `${actName} — areas counsel could review`,
        currentIssue: `The client's current posture has not yet been mapped against the changes proposed by ${bill.billNumber}.`,
        recommendation: `Counsel may wish to review the client's current obligations under ${actName} against each proposed amendment to identify potential gaps, should the bill advance.`,
        reason: bill.summary ?? `${bill.billNumber} — ${bill.title}`,
      },
    ],
    relevantClientText: client.termsAndConditions
      ? [
          {
            source: "Terms & Conditions",
            excerpt: (client.termsAndConditions ?? "").slice(0, 240),
            issue: `These terms could be revisited if ${bill.billNumber}'s proposed amendments to ${actName} advance.`,
          },
        ]
      : [],
    lawyerVerificationQuestions: [
      `Does ${client.name} currently rely on any provision that ${bill.billNumber} proposes to modify?`,
      `What would the cost and lead time be if operations had to align with a revised ${actName}?`,
      `Are there client communications (T&Cs, policies, product labels) that might need review?`,
    ],
    emailDraft: {
      subject: `${bill.billNumber} — monitoring update for ${client.name}`,
      body: `Hello,\n\nWe are monitoring Bill ${bill.billNumber} (${bill.title}), which, if enacted, may be relevant to ${client.name}.\n\nWhat the bill proposes\nThe bill would amend ${actList}. The changes remain proposals — the bill has not received royal assent and may be amended or may not pass.\n\nPotential areas to watch for ${client.name}\nBased on the client profile (${client.industry}), areas that might warrant attention include contractual terms, operational compliance, and disclosure or labelling practices.\n\nHow we can help\nWe could review your terms and conditions or contracts to identify potential exposures, and provide ongoing regulatory monitoring as the bill progresses through Parliament.\n\nWe would welcome a conversation about whether any of these areas merit a closer look.\n\n— Ingenium`,
    },
    confidence: 0.55,
    humanReviewRequired: true,
    humanReviewReason:
      "Generic synthesized analysis (no AI key, no canned demo for this pair). Counsel must verify before client use.",
    saved: false,
    createdAt: new Date().toISOString(),
  };
}

clientImpactRouter.post(
  "/analyze",
  safe(async (req, res) => {
    const { clientId, billId } = req.body ?? {};
    if (!clientId || !billId) {
      return res.status(400).json({ error: "clientId and billId required" });
    }
    const client = await findRecord<Client>(FILES.clients, clientId);
    const bill = await findRecord<Bill>(FILES.bills, billId);
    if (!client) return res.status(404).json({ error: "client not_found" });
    if (!bill) return res.status(404).json({ error: "bill not_found" });

    // Grounded path: run the client against the bill's counsel-APPROVED
    // provision changes (pipeline stages 1–2 output). Falls through to the
    // canned/synthesized paths when there is nothing approved, no API key, or
    // the AI calls fail.
    // Optional reviewing-lawyer instructions (regen-with-guidance). Transient:
    // used for this generation only, never persisted on the analysis record.
    const guidance = String(req.body?.guidance ?? "").trim().slice(0, 2000);

    let result: ClientImpactAnalysis | null = null;
    const { changes, approvedCount } = await loadApprovedChanges(billId);
    if (approvedCount > 0) {
      // A prior brief for the pair means this is a REGENERATION: hand the old
      // brief to the agent so it revises (and guidance can critique it).
      const priorBrief = latestBriefFor(
        presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts)),
        client.id,
        bill.id,
      );
      const budget = createAiBudget();
      const body = await analyzeClientFromChanges(
        { bill, client, changes, guidance, priorBrief },
        budget,
      );
      if (body) {
        result = {
          ...body,
          id: "",
          clientId: client.id,
          billId: bill.id,
          saved: false,
          createdAt: new Date().toISOString(),
        };
      }
    }
    if (!result) {
      const canned = findCannedImpact({ clientId: client.id, bill });
      if (canned) {
        console.log("[scan] using canned impact for cold demo path");
        result = {
          ...canned,
          id: "",
          clientId: client.id,
          billId: bill.id,
          saved: false,
          createdAt: new Date().toISOString(),
        };
      } else {
        console.log("[scan] using synthesized generic impact fallback");
        result = synthesizeFallback(bill, client);
      }
    }

    const review = flagImpactReview(result);
    const analysis: ClientImpactAnalysis = {
      ...result,
      id: `cia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientId: client.id,
      billId: bill.id,
      saved: false,
      createdAt: new Date().toISOString(),
      humanReviewRequired: result.humanReviewRequired || review.required,
      humanReviewReason: result.humanReviewReason ?? review.reason,
    };

    // One critical section per store mutation: concurrent /analyze calls each
    // do readAll → mutate → writeAll, so without the lock the last writer
    // clobbers its siblings' upserts.
    await withFileLock(FILES.impacts, async () => {
      await upsert(FILES.impacts, analysis);

      // Prune history: keep only the newest analyses for this (client, bill) pair.
      const all = presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts));
      const pair = all
        .filter((a) => a.clientId === client.id && a.billId === bill.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (pair.length > MAX_HISTORY_PER_PAIR) {
        const drop = new Set(pair.slice(MAX_HISTORY_PER_PAIR).map((a) => a.id));
        await writeAll(
          FILES.impacts,
          all.filter((a) => !drop.has(a.id)),
        );
      }
    });

    const email = await sendClientImpactCompleteEmail({
      analysis,
      client,
      bill,
    });
    res.json({ analysis, email });
  }),
);

// Bills that are ready to scan against clients: at least one counsel-approved
// op that still resolves against the cached provision deltas. Registered
// BEFORE /:id (Express matches in order; /:id would swallow /scan-ready).
clientImpactRouter.get(
  "/scan-ready",
  safe(async (_req, res) => {
    // One readAll per store + Map lookups (the old shape re-read the deltas
    // and bills files once per approval record — an N+1).
    const approvals = presentOnly(
      await readAll<{ id: string; keys: string[] }>(FILES.approvals),
    );
    const deltasById = new Map(
      presentOnly(
        await readAll<{ id: string; deltas: ProvisionDelta[]; createdAt?: string }>(
          FILES.provisionDeltas,
        ),
      ).map((r) => [r.id, r]),
    );
    const billsById = new Map(
      presentOnly(await readAll<Bill>(FILES.bills)).map((b) => [b.id, b]),
    );

    const out: ScanReadyBill[] = [];
    for (const rec of approvals) {
      if (!rec.keys?.length) continue;
      const deltaRec = deltasById.get(rec.id);
      if (!deltaRec) continue;
      const approved = new Set(rec.keys);
      let approvedOpCount = 0;
      const actTitles: string[] = [];
      for (const delta of presentOnly(deltaRec.deltas ?? [])) {
        const n = (delta.operations ?? []).filter((op) => approved.has(op.key)).length;
        if (n > 0) {
          approvedOpCount += n;
          actTitles.push(delta.title);
        }
      }
      if (approvedOpCount === 0) continue;
      const bill = billsById.get(rec.id);
      if (!bill) continue;
      out.push({
        billId: bill.id,
        billNumber: bill.billNumber,
        title: bill.title,
        shortTitle: bill.shortTitle,
        status: bill.status,
        session: bill.session,
        approvedOpCount,
        actTitles,
        computedAt: deltaRec.createdAt ?? "",
      });
    }
    out.sort((a, b) => b.computedAt.localeCompare(a.computedAt));
    res.json(out);
  }),
);

clientImpactRouter.get(
  "/scan-ready/:billId",
  safe(async (req, res) => {
    const billId = String(req.params.billId); // safe() loses the route-string param inference
    const bill = await findRecord<Bill>(FILES.bills, billId);
    if (!bill) return res.status(404).json({ error: "bill not_found" });
    const { changes, approvedCount } = await loadApprovedChanges(billId);
    const detail: ScanReadyDetail = { billId: bill.id, approvedCount, changes };
    res.json(detail);
  }),
);

// ── Impact scans (the fast scorer agent) ─────────────────────────────────────

/**
 * Client-facing scan shape: the stored record WITHOUT the numeric score
 * (backend-only ranking key), plus whether a full brief already exists for the
 * pair. Omit<> keeps the type honest; the runtime destructure in toScanView
 * keeps the value honest.
 */
interface ImpactScanView extends Omit<ImpactScan, "score"> {
  hasBrief: boolean;
  analysisId?: string;
}

function toScanView(
  scan: ImpactScan,
  brief: ClientImpactAnalysis | undefined,
): ImpactScanView {
  // Explicit allowlist (not a `score`-only denylist): a field added to
  // ImpactScan later must be opted IN here before it can reach a client.
  return {
    id: scan.id,
    clientId: scan.clientId,
    billId: scan.billId,
    band: scan.band,
    rationale: scan.rationale,
    topAreas: scan.topAreas,
    source: scan.source,
    scannedAt: scan.scannedAt,
    hasBrief: !!brief,
    ...(brief ? { analysisId: brief.id } : {}),
  };
}

/** Newest brief for a (client, bill) pair, if any. */
function latestBriefFor(
  impacts: ClientImpactAnalysis[],
  clientId: string,
  billId: string,
): ClientImpactAnalysis | undefined {
  return impacts
    .filter((a) => a.clientId === clientId && a.billId === billId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// Fast impact score for ONE (client, bill) pair — seconds, not the ~30s brief.
// Persisted latest-wins under a deterministic id; the response NEVER carries
// the numeric score.
clientImpactRouter.post(
  "/scan",
  safe(async (req, res) => {
    const clientId = String(req.body?.clientId ?? "");
    const billId = String(req.body?.billId ?? "");
    if (!clientId || !billId) {
      return res.status(400).json({ error: "clientId and billId required" });
    }
    const client = await findRecord<Client>(FILES.clients, clientId);
    const bill = await findRecord<Bill>(FILES.bills, billId);
    if (!client) return res.status(404).json({ error: "client not_found" });
    if (!bill) return res.status(404).json({ error: "bill not_found" });

    const { changes, approvedCount } = await loadApprovedChanges(billId);
    let scored: ScoreBody & { source: "ai" | "fallback" };
    if (approvedCount === 0) {
      scored = {
        score: 0,
        band: "low",
        rationale:
          "No approved changes for this bill — run the stage-2 delta and approve amendments first.",
        topAreas: [],
        source: "fallback",
      };
    } else {
      scored = await scoreClientAgainstChanges({ bill, client, changes }, createAiBudget());
    }

    const record: ImpactScan = {
      id: `scan-${clientId}-${billId}`, // deterministic ⇒ upsert is latest-wins per pair
      clientId,
      billId,
      score: scored.score,
      band: scored.band,
      rationale: scored.rationale,
      topAreas: scored.topAreas,
      source: scored.source,
      scannedAt: new Date().toISOString(),
    };
    await withFileLock(SCANS_FILE, () => upsert(SCANS_FILE, record));

    const impacts = presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts));
    res.json({ scan: toScanView(record, latestBriefFor(impacts, clientId, billId)) });
  }),
);

// All scans for a bill, ranked by the stored (backend-only) score — the
// scoreboard feed. Registered BEFORE /:id (Express matches in order; /:id
// would swallow /scans).
clientImpactRouter.get(
  "/scans",
  safe(async (req, res) => {
    const billId = String(req.query.billId ?? "");
    if (!billId) return res.status(400).json({ error: "billId required" });

    const scans = presentOnly(await readAll<ImpactScan>(SCANS_FILE)).filter(
      (s) => s.billId === billId,
    );
    // Join clients once: drop scans whose client no longer exists, and use the
    // names for deterministic tie-breaks.
    const clientsById = new Map(
      presentOnly(await readAll<Client>(FILES.clients)).map((c) => [c.id, c]),
    );
    // Join impacts once: newest brief per pair for hasBrief/analysisId.
    const latestByPair = new Map<string, ClientImpactAnalysis>();
    for (const a of presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts))) {
      const k = `${a.clientId}|${a.billId}`;
      const cur = latestByPair.get(k);
      if (!cur || a.createdAt.localeCompare(cur.createdAt) > 0) latestByPair.set(k, a);
    }

    const name = (s: ImpactScan) => clientsById.get(s.clientId)?.name ?? "";
    const rank = (s: ImpactScan) => (Number.isFinite(s.score) ? s.score : 0);
    const out = scans
      .filter((s) => clientsById.has(s.clientId))
      .sort((a, b) => rank(b) - rank(a) || name(a).localeCompare(name(b)))
      .map((s) => toScanView(s, latestByPair.get(`${s.clientId}|${s.billId}`)));
    res.json(out);
  }),
);

// ── Brief library (the stage-4 entry) ────────────────────────────────────────
// FLAT index: one entry per latest-(client, bill) pair, chronological (newest
// first) — the library list filters client-side by bill/client. `approved`
// mirrors the analysis' `saved` flag (the counsel-approval gate). Bands come
// from the scans store when the pair was scanned (never the numeric score).
// Registered BEFORE /:id (Express matches in order).
interface BriefIndexEntry {
  analysisId: string;
  billId: string;
  billNumber: string;
  billTitle: string;
  billShortTitle?: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  band?: ScanBand;
  approved: boolean;
}

clientImpactRouter.get(
  "/briefs",
  safe(async (_req, res) => {
    const impacts = presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts));
    // Latest analysis per (client, bill) pair.
    const latestByPair = new Map<string, ClientImpactAnalysis>();
    for (const a of impacts) {
      const k = `${a.clientId}|${a.billId}`;
      const cur = latestByPair.get(k);
      if (!cur || a.createdAt.localeCompare(cur.createdAt) > 0) latestByPair.set(k, a);
    }

    const clientsById = new Map(
      presentOnly(await readAll<Client>(FILES.clients)).map((c) => [c.id, c]),
    );
    const bandByPair = new Map<string, ScanBand>();
    for (const s of presentOnly(await readAll<ImpactScan>(SCANS_FILE))) {
      bandByPair.set(`${s.clientId}|${s.billId}`, s.band);
    }
    // One bills read serves every entry (bills.json is large — don't re-read
    // per pair via findRecord).
    const billsById = new Map(
      presentOnly(await readAll<Bill>(FILES.bills)).map((b) => [b.id, b]),
    );

    const out: BriefIndexEntry[] = [];
    for (const a of latestByPair.values()) {
      const client = clientsById.get(a.clientId);
      const bill = billsById.get(a.billId);
      if (!client || !bill) continue; // orphaned pair — client or bill deleted
      out.push({
        analysisId: a.id,
        billId: a.billId,
        billNumber: bill.billNumber,
        billTitle: bill.title,
        ...(bill.shortTitle ? { billShortTitle: bill.shortTitle } : {}),
        clientId: a.clientId,
        clientName: client.name,
        createdAt: a.createdAt,
        ...(bandByPair.has(`${a.clientId}|${a.billId}`)
          ? { band: bandByPair.get(`${a.clientId}|${a.billId}`) }
          : {}),
        approved: a.saved === true,
      });
    }
    // Chronological, newest first; analysisId tiebreak keeps the order stable.
    out.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.analysisId.localeCompare(b.analysisId),
    );
    res.json(out);
  }),
);

// The brief is identified by (client, bill). Returns the most recent analysis
// for that pair so deep links like /clients/:clientId/bills/:billId resolve.
clientImpactRouter.get(
  "/by-pair",
  safe(async (req, res) => {
    const clientId = String(req.query.clientId ?? "");
    const billId = String(req.query.billId ?? "");
    if (!clientId || !billId) {
      return res.status(400).json({ error: "clientId and billId required" });
    }
    const all = presentOnly(await readAll<ClientImpactAnalysis>(FILES.impacts));
    const match = all
      .filter((a) => a.clientId === clientId && a.billId === billId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!match) return res.status(404).json({ error: "not_found" });
    res.json(match);
  }),
);

clientImpactRouter.get(
  "/:id",
  safe(async (req, res) => {
    const a = await findRecord<ClientImpactAnalysis>(FILES.impacts, String(req.params.id));
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json(a);
  }),
);

clientImpactRouter.post(
  "/:id/save",
  safe(async (req, res) => {
    // find + upsert is a read-modify-write: take the impacts lock so a
    // concurrent /analyze prune can't clobber (or be clobbered by) the save.
    const saved = await withFileLock(FILES.impacts, async () => {
      const a = await findRecord<ClientImpactAnalysis>(FILES.impacts, String(req.params.id));
      if (!a) return null;
      a.saved = true;
      await upsert(FILES.impacts, a);
      return a;
    });
    if (!saved) return res.status(404).json({ error: "not_found" });
    res.json(saved);
  }),
);

clientImpactRouter.post(
  "/:id/email-lawyer",
  safe(async (req, res) => {
    const a = await findRecord<ClientImpactAnalysis>(FILES.impacts, String(req.params.id));
    if (!a) return res.status(404).json({ error: "not_found" });
    // The approval gate, enforced server-side: unapproved AI output cannot
    // leave the building, whatever the client UI says.
    if (!a.saved) return res.status(409).json({ error: "approval_required" });
    const client = await findRecord<Client>(FILES.clients, a.clientId);
    const bill = await findRecord<Bill>(FILES.bills, a.billId);
    if (!client || !bill) return res.status(404).json({ error: "linked records missing" });
    const email = await sendClientImpactCompleteEmail({
      analysis: a,
      client,
      bill,
    });
    res.json({ email });
  }),
);
