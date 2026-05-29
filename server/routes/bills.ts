import { Router } from "express";
import type {
  AmendmentExtraction,
  BaseLaw,
  Bill,
  LawVersion,
  VersionStatus,
} from "../../src/types.js";
import { normalizeBill } from "../services/billNormalizer.js";
import { ensurePracticeAreas } from "../../src/lib/practiceAreas.js";
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
import {
  actsAffectedByBill,
  loadActRegistry,
  type AffectedAct,
} from "../services/seedSource.js";
import { loadSeedSnapshot } from "../seed/seedDemo.js";

export const billsRouter = Router();

// The list view never needs the heavy per-bill payload (full clause text, the
// legislative path, recorded divisions, or the raw source record). Stripping
// them keeps /api/bills small and fast; the detail route returns everything.
const LIST_OMIT = new Set(["clauses", "legislativePath", "divisions", "rawJson"]);
function toListItem(bill: Bill) {
  const full = ensurePracticeAreas(bill) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(full)) {
    if (!LIST_OMIT.has(key)) out[key] = value;
  }
  return out;
}

billsRouter.get("/", async (_req, res) => {
  const bills = await readAll<Bill>(FILES.bills);
  res.json(bills.map(toListItem));
});

billsRouter.get("/:id", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "not_found" });
  res.json(ensurePracticeAreas(bill));
});

billsRouter.get("/:id/law-versions", async (req, res) => {
  const all = await readAll<LawVersion>(FILES.lawVersions);
  res.json(all.filter((lv) => lv.sourceBillId === req.params.id));
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

function clausesForAct(bill: Bill, act: AffectedAct): Bill["clauses"] {
  const ids = new Set(act.clauseIds);
  return (bill.clauses ?? []).filter((c) => ids.has(c.id));
}

function buildStubLawVersion(args: {
  bill: Bill;
  act: AffectedAct;
}): LawVersion {
  const { bill, act } = args;
  const stubSlug = act.slug ?? `unregistered:${act.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const clauses = clausesForAct(bill, act);
  const updatedText =
    clauses.length > 0
      ? clauses
          .map((c) => {
            const head = [c.number, c.heading].filter(Boolean).join(" — ");
            return head ? `${head}\n${c.text}` : c.text;
          })
          .join("\n\n")
      : `${bill.title}\n\nThis bill is tracked from LEGISinfo. Full clause text has not been ingested yet — open the LEGISinfo source link in the right rail for the official version, then re-run normalization to populate clauses.`;
  const summary =
    clauses.length > 0
      ? `Bill ${bill.billNumber} introduces ${clauses.length} clause${clauses.length === 1 ? "" : "s"} that target the ${act.title}. The current consolidated text of this Act is not yet ingested into Ingenium, so the diff below is one-sided — it shows only the proposed amending text.`
      : `Bill ${bill.billNumber} is tracked from LEGISinfo. Clause-level Act tagging is not yet available, so this is a placeholder review surface for ${act.title}. Use it to confirm scope before triggering full extraction.`;
  return {
    id: `lv-${bill.id}-${stubSlug}`,
    baseLawId: stubSlug,
    baseLawTitle: act.title,
    sourceBillId: bill.id,
    sourceBillNumber: bill.billNumber,
    sourceBillTitle: bill.title,
    sourceBillStatus: bill.status,
    legislativeMomentum: bill.legislativeMomentum,
    versionStatus: versionStatusFromBill(bill),
    humanApproved: false,
    oldText: "",
    updatedText,
    affectedSections: clauses
      .map((c) => c.number)
      .filter((n): n is string => typeof n === "string"),
    changeTypes: ["add"],
    deltaSummary: summary,
    detailedDelta: summary,
    effectiveDate: null,
    comingIntoForceText: null,
    confidence: 0.4,
    humanReviewRequired: true,
    humanReviewReason:
      "Current consolidated text for this Act is not yet ingested. Add an entry to data/laws/registry.json and re-run the law retrieval script to enable a full diff.",
    createdAt: new Date().toISOString(),
  };
}

async function buildLawVersionForRegisteredAct(args: {
  bill: Bill;
  act: AffectedAct;
  baseLaw: BaseLaw;
}): Promise<LawVersion | null> {
  const { bill, act, baseLaw } = args;
  // Constrain the prompt to clauses targeting this Act so multi-Act bills
  // produce one focused extraction per Act rather than one mega-prompt.
  const billForAct: Bill = { ...bill, clauses: clausesForAct(bill, act) };

  const amendments = await extractAmendmentsFromBill(billForAct, baseLaw);
  const updatedText = amendments
    ? await generateUpdatedLawText(baseLaw, amendments)
    : null;

  if (!amendments || !updatedText) return null;

  const a: AmendmentExtraction = amendments;
  const review = flagAmendmentReview(a);
  return {
    id: `lv-${bill.id}-${baseLaw.id}`,
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
}

billsRouter.post("/:id/extract-delta", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  const registry = await loadActRegistry();
  const baseLaws = await readAll<BaseLaw>(FILES.baseLaws);
  const baseLawById = new Map(baseLaws.map((bl) => [bl.id, bl] as const));
  const snapshot = await loadSeedSnapshot();
  const cannedByBaseLaw = new Map(
    snapshot.lawVersions
      .filter((lv) => lv.sourceBillId === bill.id)
      .map((lv) => [lv.baseLawId, lv] as const),
  );

  let acts = actsAffectedByBill(bill, registry);
  if (acts.length === 0) {
    // Bill has no clause-level Act tagging (the 158 bills loaded from the
    // raw LEGISinfo snapshot). Synthesize a single "subject Act" derived
    // from the bill title so Delta Workspace still renders something.
    // Matches: "An Act to amend the Foo Bar Act (parenthetical)"  →  "Foo Bar Act"
    //          "An Act respecting the Foo Bar"                    →  "Foo Bar Act"
    let subjectTitle = bill.title;
    const amendActMatch = bill.title.match(
      /amend(?:ing)? the ([A-Z][^,()]*? Act)\b/,
    );
    const amendOtherMatch = bill.title.match(
      /amend(?:ing)? the (Criminal Code|Customs Tariff|Income Tax Act|[A-Z][a-z]+(?: [A-Z][a-z]+)* (?:Code|Tariff|Regulations))\b/,
    );
    const enactMatch = bill.title.match(
      /(?:enact|respecting) (?:the\s+)?([A-Z][^,()]*?)(?:\s*\(|,|$)/,
    );
    if (amendActMatch) {
      subjectTitle = amendActMatch[1].trim();
    } else if (amendOtherMatch) {
      subjectTitle = amendOtherMatch[1].trim();
    } else if (enactMatch) {
      const m = enactMatch[1].trim();
      subjectTitle = /Act$/i.test(m) ? m : `${m} Act`;
    } else {
      subjectTitle = bill.title.replace(/\s*\(.*$/, "").trim() || bill.title;
    }
    acts = [
      {
        title: subjectTitle,
        slug: null,
        clauseIds: (bill.clauses ?? []).map((c) => c.id),
      },
    ];
  }

  const existing = await readAll<LawVersion>(FILES.lawVersions);
  const existingByPair = new Map<string, LawVersion>(
    existing.map((lv) => [`${lv.sourceBillId}|${lv.baseLawId}`, lv]),
  );

  const result: LawVersion[] = [];
  const errors: string[] = [];

  for (const act of acts) {
    const stubSlug = act.slug ?? `unregistered:${act.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const pairKey = `${bill.id}|${stubSlug}`;
    const cached = existingByPair.get(pairKey);
    if (cached) {
      result.push(cached);
      continue;
    }

    // Cold-demo cache (e.g. S-202 × FDA) wins over Gemini.
    const canned = cannedByBaseLaw.get(stubSlug);
    if (canned) {
      const cloned: LawVersion = {
        ...canned,
        id: `lv-${bill.id}-${stubSlug}`,
        createdAt: new Date().toISOString(),
      };
      await upsert(FILES.lawVersions, cloned);
      result.push(cloned);
      continue;
    }

    if (act.slug) {
      const baseLaw = baseLawById.get(act.slug);
      if (baseLaw) {
        const lv = await buildLawVersionForRegisteredAct({
          bill,
          act,
          baseLaw,
        });
        if (lv) {
          await upsert(FILES.lawVersions, lv);
          result.push(lv);
          continue;
        }
        errors.push(
          `Live extraction failed for "${act.title}" — set GEMINI_API_KEY in .env or check the server log.`,
        );
        // Still surface a stub so the workspace renders something.
      }
    }

    const stub = buildStubLawVersion({ bill, act });
    await upsert(FILES.lawVersions, stub);
    result.push(stub);
  }

  res.json({ lawVersions: result, errors });
});
