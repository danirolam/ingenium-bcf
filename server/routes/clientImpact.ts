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
import { DEMO } from "../seed/seedDemo.js";

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
    console.log("[gemini] using fallback for analyzeClientImpact");
    result = {
      ...DEMO.cannedImpact,
      id: "",
      clientId: client.id,
      lawVersionId: lv.id,
      saved: false,
      createdAt: new Date().toISOString(),
    };
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
