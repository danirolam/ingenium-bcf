import { Router } from "express";
import type { LawVersion } from "../../src/types.js";
import {
  FILES,
  findById,
  readAll,
  removeById,
  upsert,
} from "../services/jsonStore.js";

export const lawVersionsRouter = Router();

// On serverless the store lives in an instance's ephemeral /tmp, so an on-demand
// law version generated on one instance may not exist on the instance handling a
// later mutation. The client already holds the full record, so these routes
// accept it in the body and upsert it — the action never 404s and the change
// persists for the rest of the session.
function resolveLv(
  req: { params: { id: string }; body?: { lawVersion?: LawVersion } },
  stored: LawVersion | undefined,
): LawVersion | null {
  if (stored) return stored;
  const fromBody = req.body?.lawVersion;
  if (fromBody && fromBody.id === req.params.id) return fromBody;
  return null;
}

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
  const stored = await findById<LawVersion>(FILES.lawVersions, req.params.id);
  const lv = resolveLv(req, stored);
  if (!lv) return res.status(404).json({ error: "not_found" });
  lv.humanApproved = true;
  lv.humanReviewRequired = false;
  lv.humanReviewReason = null;
  await upsert(FILES.lawVersions, lv);
  res.json(lv);
});

lawVersionsRouter.post("/:id/needs-review", async (req, res) => {
  const stored = await findById<LawVersion>(FILES.lawVersions, req.params.id);
  const lv = resolveLv(req, stored);
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

lawVersionsRouter.delete("/:id", async (req, res) => {
  await removeById<LawVersion>(FILES.lawVersions, req.params.id);
  res.json({ ok: true });
});
