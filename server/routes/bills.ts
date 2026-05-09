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
import { DEMO } from "../seed/seedDemo.js";

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

  const baseLaws = await readAll<BaseLaw>(FILES.baseLaws);
  const baseLaw = baseLaws[0] ?? DEMO.baseLaw;

  // Reuse existing approved/derived LawVersion if one already exists for this bill.
  const all = await readAll<LawVersion>(FILES.lawVersions);
  const existing = all.find((lv) => lv.sourceBillId === bill.id);
  if (existing) return res.json(existing);

  let amendments = await extractAmendmentsFromBill(bill, baseLaw);
  let updatedText: string | null = null;
  if (amendments) updatedText = await generateUpdatedLawText(baseLaw, amendments);

  if (!amendments || !updatedText) {
    // Fallback: use canned demo derivation so demo never breaks.
    console.log("[gemini] using fallback for extract-delta");
    const seed = DEMO.lawVersion;
    const fallback: LawVersion = {
      ...seed,
      id: `lv-${bill.id}-${Date.now()}`,
      sourceBillId: bill.id,
      sourceBillNumber: bill.billNumber,
      sourceBillTitle: bill.title,
      sourceBillStatus: bill.status,
      legislativeMomentum: bill.legislativeMomentum,
      versionStatus: versionStatusFromBill(bill),
      humanApproved: false,
      createdAt: new Date().toISOString(),
    };
    await upsert(FILES.lawVersions, fallback);
    return res.json(fallback);
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
