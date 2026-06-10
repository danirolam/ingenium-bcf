import { Router } from "express";
import type {
  Bill,
  Client,
  ClientImpactAnalysis,
} from "../../src/types.js";
import { sendClientImpactCompleteEmail } from "../services/email.js";
import {
  analyzeClientImpact,
  billAffectedActs,
  buildImpactPrompt,
} from "../services/gemini.js";
import { claudeJson } from "../services/claude.js";
import { flagImpactReview } from "../services/humanReview.js";
import { FILES, findById, readAll, upsert } from "../services/jsonStore.js";
import { findCannedImpact } from "../seed/seedDemo.js";

export const clientImpactRouter = Router();

clientImpactRouter.post("/analyze", async (req, res) => {
  const { clientId, billId } = req.body ?? {};
  if (!clientId || !billId) {
    return res.status(400).json({ error: "clientId and billId required" });
  }
  const client = await findById<Client>(FILES.clients, clientId);
  const bill = await findById<Bill>(FILES.bills, billId);
  if (!client) return res.status(404).json({ error: "client not_found" });
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  // Gemini if its key is set, else the Anthropic key with the same prompt —
  // either way a missing/failed call degrades to the canned/synthesized memo.
  let result = await analyzeClientImpact({ bill, client });
  if (!result)
    result = await claudeJson<ClientImpactAnalysis>(buildImpactPrompt({ bill, client }));
  if (!result) {
    const canned = findCannedImpact({ clientId: client.id, bill });
    if (canned) {
      console.log("[gemini] using canned impact for cold demo path");
      result = {
        ...canned,
        id: "",
        clientId: client.id,
        billId: bill.id,
        saved: false,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Generic synthesized fallback — keeps the app usable without
      // GEMINI_API_KEY for any (client, bill) pair.
      console.log("[gemini] using synthesized generic impact fallback");
      const acts = billAffectedActs(bill);
      const actName = acts[0] ?? "the affected legislation";
      const actList = acts.join(", ") || "the affected provisions";
      result = {
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
  }

  const review = flagImpactReview(result as ClientImpactAnalysis);
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
  const email = await sendClientImpactCompleteEmail({
    analysis,
    client,
    bill,
  });
  res.json({ analysis, email });
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
