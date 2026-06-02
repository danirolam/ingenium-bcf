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
  interpretAmendmentsTooled,
} from "../services/gemini.js";
import {
  applyAmendments,
  diffProvisions,
  diffSummary,
  findByPath,
} from "../services/amendmentEngine.js";
import { interpretAmendmentsClaude } from "../services/claude.js";
import { applyGroups, parseBillAmendments } from "../services/billAmendments.js";
import { loadActProvisions } from "../services/lawProvisions.js";
import { resolveBatch, type ScalpelTask } from "../services/scalpel.js";
import { createAiBudget } from "../services/aiBudget.js";
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

// Proxy the bill's official PDF from parl.ca and serve it from our own origin,
// so it can be embedded in an <iframe> (parl.ca's X-Frame-Options would block a
// direct embed). The PDF sits next to the XML: …/<billNo>_<v>/<billNo>_<v>.PDF.
billsRouter.get("/:id/pdf", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "bill not_found" });
  const UA = "Ingenium-PDF/0.1 (legislative viewer)";
  const docViewer = (bill.rawJson as any)?.source?.documentViewer as string | undefined;

  const tryFetch = async (u: string) => {
    try {
      const r = await fetch(u, { headers: { "user-agent": UA } });
      if (r.ok && (r.headers.get("content-type") || "").includes("pdf")) return r;
    } catch {
      /* try next */
    }
    return null;
  };

  // 1) Derive from the XML URL: …/C-265_1/C-265_E.xml → …/C-265_1/C-265_1.PDF
  let r: Response | null = null;
  if (bill.textSourceUrl) {
    r = await tryFetch(bill.textSourceUrl.replace(/\/([^/]+)\/[^/]+\.xml$/i, "/$1/$1.PDF"));
  }
  // 2) Fallback: scrape the DocumentViewer page for the authoritative .PDF link.
  if (!r && docViewer) {
    try {
      const page = await fetch(docViewer, { headers: { "user-agent": UA } }).then((x) => x.text());
      const m = page.match(/\/Content\/Bills\/[^"' ]+\.PDF/i);
      if (m) r = await tryFetch(new URL(m[0], "https://www.parl.ca").href);
    } catch {
      /* give up below */
    }
  }
  if (!r) return res.status(404).json({ error: "pdf not_found" });

  const buf = Buffer.from(await r.arrayBuffer());
  res.set("content-type", "application/pdf");
  res.set("content-disposition", `inline; filename="${bill.billNumber}.pdf"`);
  res.set("cache-control", "public, max-age=86400");
  res.send(buf);
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

// Grounded provision-level delta: for each REGISTERED Act the bill amends, have
// the AI interpret the amending instructions into operations, verify each anchor
// against the real Act, apply them, and diff before/after by provision. Returns
// only the changed provisions (a bill touches a handful), with verification.
billsRouter.post("/:id/provision-delta", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  // Cache: a bill's delta is interpreted once, then served instantly. Pass
  // ?refresh=1 to recompute (e.g. after re-ingesting the Act).
  type CachedDelta = { id: string; deltas: unknown[]; errors: string[]; createdAt: string };
  if (req.query.refresh !== "1") {
    const cached = await findById<CachedDelta>(FILES.provisionDeltas, bill.id);
    if (cached) {
      return res.json({
        deltas: cached.deltas,
        errors: cached.errors,
        cached: true,
        computedAt: cached.createdAt,
      });
    }
  }

  const registry = await loadActRegistry();
  const acts = actsAffectedByBill(bill, registry).filter((a) => a.slug);
  // Fallback: clause-level targetActs are often missing (lossy ingestion), so
  // also pull in any registered Act whose registry entry lists this bill.
  const have = new Set(acts.map((a) => a.slug));
  for (const [slug, entry] of Object.entries(registry)) {
    if (!have.has(slug) && (entry.relatedBills ?? []).includes(bill.billNumber)) {
      acts.push({ title: entry.title, slug, clauseIds: (bill.clauses ?? []).map((c) => c.id) });
      have.add(slug);
    }
  }
  const errors: string[] = [];

  // Preferred path: parse the bill's own XML — the inserted statutory text is
  // already structured in <AmendedText>, so we read op+anchor and splice the
  // text deterministically. Partial in-provision edits go to the AI scalpel.
  let parsed: ReturnType<typeof parseBillAmendments> = { groups: new Map(), edits: new Map() };
  if (bill.textSourceUrl) {
    try {
      const xmlRes = await fetch(bill.textSourceUrl, { headers: { "user-agent": "Ingenium-Delta/0.1" } });
      if (xmlRes.ok) parsed = parseBillAmendments(await xmlRes.text(), registry);
    } catch {
      /* network/parse failure → AI fallback below */
    }
  }

  // One shared budget for every Anthropic call this request makes: the first
  // rate-limit/failure trips it, aborting in-flight sibling calls and skipping
  // pending ones, so we degrade to a partial result instead of hammering the
  // 50k-token/min limit.
  const aiBudget = createAiBudget();

  const results = await Promise.all(
    acts.map(async (act) => {
      const slug = act.slug as string;
      const actData = await loadActProvisions(slug);
      if (!actData) {
        errors.push(`No structured text ingested for ${act.title}.`);
        return null;
      }
      const groups = parsed.groups.get(slug) ?? [];
      const edits = parsed.edits.get(slug) ?? [];

      // Path A — deterministic structure (+ scalpel for partial edits).
      if (groups.length > 0 || edits.length > 0) {
        // 1) Whole-provision adds/replaces/repeals from <AmendedText>.
        const { after, verified } = applyGroups(actData.provisions, groups);

        // 2) Partial edits: resolve each target, batch them into AI calls,
        //    then splice the edited text back in.
        let usedAi = false;
        let incomplete = false;
        if (edits.length > 0) {
          const tasks: ScalpelTask[] = [];
          const targets: { provIndex: number; anchorFound: boolean; instruction: string }[] = [];
          edits.forEach((e, i) => {
            const hit = findByPath(after, e.sectionHint);
            if (hit.index >= 0) {
              tasks.push({ id: `e${i}`, kind: "edit", instruction: e.instruction, currentText: after[hit.index].text });
              targets.push({ provIndex: hit.index, anchorFound: hit.matched === "exact", instruction: e.instruction });
            } else {
              verified.push({ op: "amend", anchor: e.sectionHint, position: null, count: 0, anchorFound: false, note: `(target not found) ${e.instruction.slice(0, 140)}` });
            }
          });
          if (tasks.length > 0) {
            usedAi = true;
            const { results: res, incomplete: scalpelIncomplete } = await resolveBatch(actData.title, tasks, aiBudget);
            incomplete = scalpelIncomplete;
            targets.forEach((t, i) => {
              const r = res.get(`e${i}`);
              if (r?.newText) after[t.provIndex] = { ...after[t.provIndex], text: r.newText };
              verified.push({
                op: "amend", anchor: after[t.provIndex].label, position: null, count: r?.newText ? 1 : 0,
                anchorFound: t.anchorFound, note: t.instruction.slice(0, 160),
              });
            });
          }
        }

        const rows = diffProvisions(actData.provisions, after);
        return {
          slug: actData.slug, title: actData.title, citation: actData.citation,
          summary: diffSummary(rows), operations: verified,
          rows,
          source: usedAi ? "ai-assisted" : "bill-xml",
          incomplete,
        };
      }

      // Path B — fallback: let the AI interpret the whole bill for this Act.
      // The Claude path shares the rate-limit budget; the Gemini fallback
      // (used only when no Anthropic key is set) doesn't need it.
      const args = { bill, actTitle: actData.title, provisions: actData.provisions };
      const ai = process.env.ANTHROPIC_API_KEY
        ? await interpretAmendmentsClaude(args, aiBudget)
        : await interpretAmendmentsTooled(args);
      if (!ai) {
        errors.push(
          process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY
            ? `AI interpretation failed for ${act.title} — try again in a moment.`
            : `AI key missing — cannot interpret ${act.title}.`,
        );
        return null;
      }
      const { after, verified } = applyAmendments(actData.provisions, ai.operations);
      const rows = diffProvisions(actData.provisions, after);
      return {
        slug: actData.slug, title: actData.title, citation: actData.citation,
        summary: diffSummary(rows), operations: verified,
        rows,
        source: "ai",
        incomplete: "incomplete" in ai ? ai.incomplete : false,
      };
    }),
  );

  const deltas = results.filter(Boolean);
  // If an AI call was rate-limited/failed mid-run, the result is partial.
  const aiIncomplete = aiBudget.reason !== null || deltas.some((d) => d && (d as { incomplete?: boolean }).incomplete);
  const aiIncompleteReason = aiBudget.reason;
  // Only cache COMPLETE interpretations, so a rate-limited/partial run retries
  // next time (e.g. once the per-minute limit resets) instead of sticking.
  if (deltas.length > 0 && !aiIncomplete) {
    await upsert(FILES.provisionDeltas, {
      id: bill.id,
      deltas,
      errors,
      createdAt: new Date().toISOString(),
    });
  }
  res.json({ deltas, errors, cached: false, aiIncomplete, aiIncompleteReason });
});

// ── Per-amendment approvals (the phase-2 gate) ──────────────────────────────
// One record per bill holding the set of approved amendment keys ("<slug>#<i>").
// Counsel approves each placement; export is gated on all keys being approved.
type ApprovalRecord = { id: string; keys: string[] };

billsRouter.get("/:id/approvals", async (req, res) => {
  const rec = await findById<ApprovalRecord>(FILES.approvals, req.params.id);
  res.json({ keys: rec?.keys ?? [] });
});

// Toggle one key, or set many at once (approve-all-for-Act passes that Act's keys).
billsRouter.post("/:id/approvals", async (req, res) => {
  const { key, keys, approved } = (req.body ?? {}) as {
    key?: string;
    keys?: string[];
    approved?: boolean;
  };
  const incoming = (keys ?? (key ? [key] : [])).filter(Boolean);
  if (incoming.length === 0) return res.status(400).json({ error: "key or keys required" });

  const rec = (await findById<ApprovalRecord>(FILES.approvals, req.params.id)) ?? {
    id: req.params.id,
    keys: [],
  };
  const set = new Set(rec.keys);
  for (const k of incoming) (approved === false ? set.delete(k) : set.add(k));
  rec.keys = [...set];
  await upsert(FILES.approvals, rec);
  res.json({ keys: rec.keys });
});
