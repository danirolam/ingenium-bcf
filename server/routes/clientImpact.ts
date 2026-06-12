import { Router } from "express";
import type {
  Bill,
  Client,
  ClientImpactAnalysis,
  ProvisionDelta,
} from "../../src/types.js";
import { createAiBudget } from "../services/aiBudget.js";
import {
  analyzeClientFromChanges,
  loadApprovedChanges,
} from "../services/clientScan.js";
import type { ScanReadyBill, ScanReadyDetail } from "../services/clientScanCore.js";
import { sendClientImpactCompleteEmail } from "../services/email.js";
import { billAffectedActs } from "../services/gemini.js";
import { flagImpactReview } from "../services/humanReview.js";
import { FILES, findById, readAll, upsert, writeAll } from "../services/jsonStore.js";
import { findCannedImpact } from "../seed/seedDemo.js";

export const clientImpactRouter = Router();

// Keep only this many analyses per (client, bill) pair — every /analyze
// re-run adds one, and unbounded history bloats the store.
const MAX_HISTORY_PER_PAIR = 3;

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
    timing: `${bill.billNumber} is at ${bill.status}. Coming-into-force timing is unspecified — assume a 6–12 month transition window from royal assent.`,
    whyItAffectsClient: `${client.name} operates in ${client.industry} across ${client.jurisdictions.join(", ")}. ${bill.billNumber} (amending ${actList}) plausibly touches the client's operations; counsel verification is required to confirm scope and magnitude.`,
    affectedClientAreas: [
      "Contractual terms",
      "Operational compliance",
      "Disclosure / labelling",
    ],
    requiredAdaptations: [
      {
        area: `${actName} compliance review`,
        currentIssue: `Existing client posture has not been mapped against the changes proposed by ${bill.billNumber}.`,
        recommendation: `Pull the client's current obligations under ${actName} and walk each affected provision against today's practice to identify gaps.`,
        reason: bill.summary ?? `${bill.billNumber} — ${bill.title}`,
      },
    ],
    relevantClientText: client.termsAndConditions
      ? [
          {
            source: "Terms & Conditions",
            excerpt: (client.termsAndConditions ?? "").slice(0, 240),
            issue: `Verify these terms remain consistent with ${bill.billNumber}'s amendments to ${actName}.`,
          },
        ]
      : [],
    lawyerVerificationQuestions: [
      `Does ${client.name} currently rely on any provision modified by ${bill.billNumber}?`,
      `What is the cost and lead time of bringing operations into compliance with the revised ${actName}?`,
      `Are there client communications (T&Cs, policies, product labels) that need to be re-papered?`,
    ],
    emailDraft: {
      subject: `${bill.billNumber} — preliminary impact note for ${client.name}`,
      body: `Hi team,\n\nPreliminary impact note on ${bill.billNumber} (${bill.title}) for ${client.name}:\n\nThe bill amends ${actList}. Based on the client's profile (${client.industry}, ${(client.jurisdictions ?? []).join(", ")}), the changes likely touch contractual terms, operational compliance, and disclosure / labelling.\n\nNext step: a lawyer-led mapping of the client's current obligations under ${actName} against the proposed amendments.\n\n— Ingenium`,
    },
    confidence: 0.55,
    humanReviewRequired: true,
    humanReviewReason:
      "Generic synthesized analysis (no Gemini, no canned demo for this pair). Counsel must verify before client use.",
    saved: false,
    createdAt: new Date().toISOString(),
  };
}

clientImpactRouter.post("/analyze", async (req, res) => {
  const { clientId, billId } = req.body ?? {};
  if (!clientId || !billId) {
    return res.status(400).json({ error: "clientId and billId required" });
  }
  const client = await findById<Client>(FILES.clients, clientId);
  const bill = await findById<Bill>(FILES.bills, billId);
  if (!client) return res.status(404).json({ error: "client not_found" });
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  // Grounded path: run the client against the bill's counsel-APPROVED
  // provision changes (pipeline stages 1–2 output). Falls through to the
  // canned/synthesized paths when there is nothing approved, no API key, or
  // the AI calls fail.
  let result: ClientImpactAnalysis | null = null;
  const { changes, approvedCount } = await loadApprovedChanges(billId);
  if (approvedCount > 0) {
    const budget = createAiBudget();
    const body = await analyzeClientFromChanges({ bill, client, changes }, budget);
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
  await upsert(FILES.impacts, analysis);

  // Prune history: keep only the newest analyses for this (client, bill) pair.
  const all = await readAll<ClientImpactAnalysis>(FILES.impacts);
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

  const email = await sendClientImpactCompleteEmail({
    analysis,
    client,
    bill,
  });
  res.json({ analysis, email });
});

// Bills that are ready to scan against clients: at least one counsel-approved
// op that still resolves against the cached provision deltas. Registered
// BEFORE /:id (Express matches in order; /:id would swallow /scan-ready).
clientImpactRouter.get("/scan-ready", async (_req, res) => {
  const approvals = await readAll<{ id: string; keys: string[] }>(FILES.approvals);
  const out: ScanReadyBill[] = [];
  for (const rec of approvals) {
    if (!rec.keys?.length) continue;
    const deltaRec = await findById<{
      id: string;
      deltas: ProvisionDelta[];
      createdAt?: string;
    }>(FILES.provisionDeltas, rec.id);
    if (!deltaRec) continue;
    const approved = new Set(rec.keys);
    let approvedOpCount = 0;
    const actTitles: string[] = [];
    for (const delta of deltaRec.deltas ?? []) {
      const n = (delta.operations ?? []).filter((op) => approved.has(op.key)).length;
      if (n > 0) {
        approvedOpCount += n;
        actTitles.push(delta.title);
      }
    }
    if (approvedOpCount === 0) continue;
    const bill = await findById<Bill>(FILES.bills, rec.id);
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
});

clientImpactRouter.get("/scan-ready/:billId", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.billId);
  if (!bill) return res.status(404).json({ error: "bill not_found" });
  const { changes, approvedCount } = await loadApprovedChanges(req.params.billId);
  const detail: ScanReadyDetail = { billId: bill.id, approvedCount, changes };
  res.json(detail);
});

// The brief is identified by (client, bill). Returns the most recent analysis
// for that pair so deep links like /clients/:clientId/bills/:billId resolve.
clientImpactRouter.get("/by-pair", async (req, res) => {
  const clientId = String(req.query.clientId ?? "");
  const billId = String(req.query.billId ?? "");
  if (!clientId || !billId) {
    return res.status(400).json({ error: "clientId and billId required" });
  }
  const all = await readAll<ClientImpactAnalysis>(FILES.impacts);
  const match = all
    .filter((a) => a.clientId === clientId && a.billId === billId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!match) return res.status(404).json({ error: "not_found" });
  res.json(match);
});

clientImpactRouter.get("/:id", async (req, res) => {
  const a = await findById<ClientImpactAnalysis>(FILES.impacts, req.params.id);
  if (!a) return res.status(404).json({ error: "not_found" });
  res.json(a);
});

clientImpactRouter.post("/:id/save", async (req, res) => {
  const a = await findById<ClientImpactAnalysis>(FILES.impacts, req.params.id);
  if (!a) return res.status(404).json({ error: "not_found" });
  a.saved = true;
  await upsert(FILES.impacts, a);
  res.json(a);
});

clientImpactRouter.post("/:id/email-lawyer", async (req, res) => {
  const a = await findById<ClientImpactAnalysis>(FILES.impacts, req.params.id);
  if (!a) return res.status(404).json({ error: "not_found" });
  const client = await findById<Client>(FILES.clients, a.clientId);
  const bill = await findById<Bill>(FILES.bills, a.billId);
  if (!client || !bill) return res.status(404).json({ error: "linked records missing" });
  const email = await sendClientImpactCompleteEmail({
    analysis: a,
    client,
    bill,
  });
  res.json({ email });
});
