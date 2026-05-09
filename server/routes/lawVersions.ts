import { Router } from "express";
import type { LawVersion } from "../../src/types.js";
import { FILES, findById, readAll, upsert } from "../services/jsonStore.js";

export const lawVersionsRouter = Router();

lawVersionsRouter.get("/", async (_req, res) => {
  const lvs = await readAll<LawVersion>(FILES.lawVersions);
  res.json(lvs);
});

lawVersionsRouter.get("/:id", async (req, res) => {
  const lv = await findById<LawVersion>(FILES.lawVersions, req.params.id);
  if (!lv) return res.status(404).json({ error: "not_found" });
  res.json(lv);
});

lawVersionsRouter.post("/:id/approve", async (req, res) => {
  const lv = await findById<LawVersion>(FILES.lawVersions, req.params.id);
  if (!lv) return res.status(404).json({ error: "not_found" });
  lv.humanApproved = true;
  lv.humanReviewRequired = false;
  lv.humanReviewReason = null;
  await upsert(FILES.lawVersions, lv);
  res.json(lv);
});

lawVersionsRouter.post("/:id/needs-review", async (req, res) => {
  const lv = await findById<LawVersion>(FILES.lawVersions, req.params.id);
  if (!lv) return res.status(404).json({ error: "not_found" });
  lv.humanApproved = false;
  lv.humanReviewRequired = true;
  lv.humanReviewReason =
    typeof req.body?.reason === "string"
      ? req.body.reason
      : (lv.humanReviewReason ?? "Flagged for manual review.");
  await upsert(FILES.lawVersions, lv);
  res.json(lv);
});
