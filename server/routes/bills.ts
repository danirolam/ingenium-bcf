import { Router } from "express";
import type {
  AmendmentExtraction,
  BaseLaw,
  Bill,
  LawVersion,
  VersionStatus,
} from "../../src/types.js";
import { normalizeBill } from "../services/billNormalizer.js";
import { sendBillUploadedEmail } from "../services/email.js";
import {
  extractAmendmentsFromBill,
  generateUpdatedLawText,
} from "../services/gemini.js";
import { flagAmendmentReview } from "../services/humanReview.js";
import {
  FILES,
  findById,
  readAll,
  upsert,
} from "../services/jsonStore.js";
import { findBaseLawForBill, loadSeedSnapshot } from "../seed/seedDemo.js";

export const billsRouter = Router();

billsRouter.get("/", async (_req, res) => {
  const bills = await readAll<Bill>(FILES.bills);
  res.json(bills);
});

billsRouter.get("/:id", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "not_found" });
  res.json(bill);
});

billsRouter.post("/upload", async (req, res) => {
  const raw = req.body;
  if (!raw || typeof raw !== "object") {
    return res.status(400).json({ error: "expected JSON body" });
  }
  const bill = normalizeBill(raw);
  await upsert(FILES.bills, bill);
  const email = await sendBillUploadedEmail(bill);
  res.json({ bill, email });
});

function versionStatusFromBill(bill: Bill): VersionStatus {
  if (bill.legislativeMomentum === "in_force") return "in_force";
  if (bill.legislativeMomentum === "passed") return "passed_pending_review";
  return "proposed_future";
}

billsRouter.post("/:id/extract-delta", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  // Reuse existing LawVersion if one already exists for this bill.
  const all = await readAll<LawVersion>(FILES.lawVersions);
  const existing = all.find((lv) => lv.sourceBillId === bill.id);
  if (existing) return res.json(existing);

  // Resolve the base law: prefer the curated bill→law link from the seed,
  // fall back to the first registered base law.
  const linked = await findBaseLawForBill(bill.id);
  const baseLaws = await readAll<BaseLaw>(FILES.baseLaws);
  const baseLaw = linked ?? baseLaws[0];
  if (!baseLaw) {
    return res.status(409).json({
      error:
        "No base law registered. Add a current law under data/laws/ and a bill→law link in data/laws/bill-law-links.45-1.json.",
    });
  }

  let amendments = await extractAmendmentsFromBill(bill, baseLaw);
  let updatedText: string | null = null;
  if (amendments) updatedText = await generateUpdatedLawText(baseLaw, amendments);

  if (!amendments || !updatedText) {
    // No live Gemini result. If the seed includes a canned LawVersion for
    // this bill we'll have already returned it via `existing` above. Surface
    // a clear error pointing the user to GEMINI_API_KEY for everything else.
    const snapshot = await loadSeedSnapshot();
    const cannedForBill = snapshot.lawVersions.find(
      (lv) => lv.sourceBillId === bill.id,
    );
    if (cannedForBill) {
      const cloned: LawVersion = {
        ...cannedForBill,
        id: `lv-${bill.id}-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      await upsert(FILES.lawVersions, cloned);
      return res.json(cloned);
    }
    return res.status(503).json({
      error:
        "Live extraction is unavailable: no canned demo for this bill and GEMINI_API_KEY is missing or the call failed. Set GEMINI_API_KEY in .env to enable live legal-delta extraction.",
    });
  }

  const a: AmendmentExtraction = amendments;
  const review = flagAmendmentReview(a);

  const lv: LawVersion = {
    id: `lv-${bill.id}-${Date.now()}`,
    baseLawId: baseLaw.id,
    baseLawTitle: baseLaw.title,
    sourceBillId: bill.id,
    sourceBillNumber: bill.billNumber,
    sourceBillTitle: bill.title,
    sourceBillStatus: bill.status,
    legislativeMomentum: bill.legislativeMomentum,
    versionStatus: versionStatusFromBill(bill),
    humanApproved: false,
    oldText: baseLaw.text,
    updatedText,
    affectedSections: a.affectedSections,
    changeTypes: a.operationTypes,
    deltaSummary: a.deltaSummary,
    detailedDelta: a.detailedDelta,
    effectiveDate: a.effectiveDate,
    comingIntoForceText: a.comingIntoForceText,
    confidence: a.confidence,
    humanReviewRequired: a.humanReviewRequired || review.required,
    humanReviewReason: a.humanReviewReason ?? review.reason,
    createdAt: new Date().toISOString(),
  };
  await upsert(FILES.lawVersions, lv);
  res.json(lv);
});
