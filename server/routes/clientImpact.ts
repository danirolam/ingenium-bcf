import { Router } from "express";
import type {
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";
import { sendClientImpactCompleteEmail } from "../services/email.js";
import { analyzeClientImpact } from "../services/gemini.js";
import { flagImpactReview } from "../services/humanReview.js";
import { FILES, findById, readAll, upsert } from "../services/jsonStore.js";
import { findCannedImpact } from "../seed/seedDemo.js";

export const clientImpactRouter = Router();

clientImpactRouter.post("/analyze", async (req, res) => {
  const { clientId, lawVersionId } = req.body ?? {};
  if (!clientId || !lawVersionId) {
    return res
      .status(400)
      .json({ error: "clientId and lawVersionId required" });
  }
  const client = await findById<Client>(FILES.clients, clientId);
  const lv = await findById<LawVersion>(FILES.lawVersions, lawVersionId);
  if (!client) return res.status(404).json({ error: "client not_found" });
  if (!lv) return res.status(404).json({ error: "lawVersion not_found" });
  if (!lv.humanApproved) {
    return res
      .status(400)
      .json({ error: "lawVersion is not human-approved" });
  }

  let result = await analyzeClientImpact({ lawVersion: lv, client });
  if (!result) {
    const canned = findCannedImpact({ clientId: client.id, lawVersion: lv });
    if (canned) {
      console.log("[gemini] using canned impact for cold demo path");
      result = {
        ...canned,
        id: "",
        clientId: client.id,
        lawVersionId: lv.id,
        saved: false,
        createdAt: new Date().toISOString(),
      };
    } else {
      // Generic synthesized fallback — keeps the app usable without
      // GEMINI_API_KEY for any (client, law) pair.
      console.log("[gemini] using synthesized generic impact fallback");
      const actName = lv.baseLawTitle.replace(/\s*\([^)]*\)\s*$/, "");
      const sections = (lv.affectedSections ?? []).join(", ") || "the affected provisions";
      result = {
        id: "",
        clientId: client.id,
        lawVersionId: lv.id,
        affected: "unclear",
        impactLevel: "medium",
        urgency: "medium",
        timing: `${lv.sourceBillNumber} is at ${lv.sourceBillStatus}. ${lv.comingIntoForceText ?? "Coming-into-force timing is unspecified — assume a 6–12 month transition window from royal assent."}`,
        whyItAffectsClient: `${client.name} operates in ${client.industry} across ${client.jurisdictions.join(", ")}. The proposed amendments to ${actName} (${sections}) plausibly touch the client's operations; counsel verification is required to confirm scope and magnitude.`,
        affectedClientAreas: [
          "Contractual terms",
          "Operational compliance",
          "Disclosure / labelling",
        ],
        requiredAdaptations: [
          {
            area: `${actName} compliance review`,
            currentIssue: `Existing client posture has not been mapped against the proposed ${sections} amendments.`,
            recommendation: `Pull the client's current obligations under ${actName} and walk each affected section against today's practice to identify gaps.`,
            reason: `${lv.deltaSummary}`,
          },
        ],
        relevantClientText: client.termsAndConditions
          ? [
              {
                source: "Terms & Conditions",
                excerpt: (client.termsAndConditions ?? "").slice(0, 240),
                issue: `Verify these terms remain consistent with the revised ${actName}.`,
              },
            ]
          : [],
        lawyerVerificationQuestions: [
          `Does ${client.name} currently rely on any provision modified by ${lv.sourceBillNumber}?`,
          `What is the cost and lead time of bringing operations into compliance with the revised ${actName}?`,
          `Are there client communications (T&Cs, policies, product labels) that need to be re-papered?`,
        ],
        emailDraft: {
          subject: `${lv.sourceBillNumber} — preliminary impact note for ${client.name}`,
          body: `Hi team,\n\nPreliminary impact note on ${lv.sourceBillNumber} (${lv.sourceBillTitle}) for ${client.name}:\n\nThe bill amends ${actName} at ${sections}. Based on the client's profile (${client.industry}, ${client.jurisdictions.join(", ")}), the changes likely touch contractual terms, operational compliance, and disclosure / labelling.\n\nNext step: a lawyer-led mapping of the client's current obligations under ${actName} against the proposed amendments.\n\n— Injenium`,
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
    lawVersionId: lv.id,
    saved: false,
    createdAt: new Date().toISOString(),
    humanReviewRequired:
      result.humanReviewRequired || review.required,
    humanReviewReason: result.humanReviewReason ?? review.reason,
  };
  await upsert(FILES.impacts, analysis);
  const email = await sendClientImpactCompleteEmail({
    analysis,
    client,
    lawVersion: lv,
  });
  res.json({ analysis, email });
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
  const lv = await findById<LawVersion>(FILES.lawVersions, a.lawVersionId);
  if (!client || !lv) return res.status(404).json({ error: "linked records missing" });
  const email = await sendClientImpactCompleteEmail({
    analysis: a,
    client,
    lawVersion: lv,
  });
  res.json({ email });
});
