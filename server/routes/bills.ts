import { Router } from "express";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { attachRowLinks, diffProvisions, diffSummary, slimUnchangedText } from "../services/amendmentEngine.js";
import { extractAmendmentUnits } from "../services/billAmendments.js";
import { loadActTree, type ActTree, type LawNavigator } from "../services/lawTree.js";
import { locateAmendments, type LocatedOp, type LocatorCtx } from "../services/amendmentLocator.js";
import { applyOperations, type ApplyOp } from "../services/amendmentApply.js";
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Compose an ancestor path back into a citation label for display, e.g.
// [section 30, subsection 1, paragraph j.01] → "30(1)(j.01)".
function composeAnchor(ancestors: { kind: string; label: string }[]): string | null {
  if (!ancestors.length) return null;
  return ancestors
    .map((a, i) => (a.kind === "definition" ? `“${a.label}”` : i === 0 || a.kind === "section" ? a.label : `(${a.label})`))
    .join("");
}

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

// Grounded provision-level delta. Extract each amendment from the bill's XML, have
// the AI LOCATE its target by ancestor path against the real Act (verifying every
// step with tools), apply the change deterministically to the Act tree, and diff.
// The AI never writes statutory text — it only points. Amendments it can't place
// are returned as `failures` (surfaced subtly), never silently mis-placed.
billsRouter.post("/:id/provision-delta", async (req, res) => {
  const bill = await findById<Bill>(FILES.bills, req.params.id);
  if (!bill) return res.status(404).json({ error: "bill not_found" });

  try {
  // Cache: a bill's delta is computed once, then served instantly. ?refresh=1 recomputes.
  type CachedDelta = { id: string; deltas: unknown[]; errors: string[]; failures: unknown[]; createdAt: string };
  if (req.query.refresh !== "1") {
    const cached = await findById<CachedDelta>(FILES.provisionDeltas, bill.id);
    if (cached) {
      return res.json({ deltas: cached.deltas, errors: cached.errors, failures: cached.failures ?? [], cached: true, computedAt: cached.createdAt });
    }
  }

  const registry = await loadActRegistry();
  const errors: string[] = [];

  // 1) Load the bill's amending XML — the network copy (with a timeout so a slow
  //    or throttling parl.ca can't hang the request), then the committed local one.
  let xml: string | null = null;
  if (bill.textSourceUrl) {
    try {
      const r = await fetch(bill.textSourceUrl, { headers: { "user-agent": "Ingenium-Delta/0.1" }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) xml = await r.text();
    } catch { /* fall back to local */ }
  }
  if (!xml) {
    try { xml = await fsp.readFile(path.join(REPO_ROOT, "data/bills", bill.session ?? "45-1", bill.billNumber, "bill.xml"), "utf8"); } catch { /* none */ }
  }
  if (!xml) {
    return res.json({ deltas: [], errors: ["Could not load the bill's amending text (XML)."], failures: [], cached: false });
  }

  // 2) Extract the discrete amendments (structural, no regex locating). Keep the
  //    units that actually change a provision (drop short-title / coming-into-force).
  const CHANGES = /repeal|replac|strik|amend|\badd(?:ing|ed|s)?\b/i;
  const units = extractAmendmentUnits(xml, registry).filter((u) => u.inserts.length > 0 || CHANGES.test(u.instructionText));

  if (!process.env.ANTHROPIC_API_KEY) {
    const failures = units.map((u) => ({ clause: u.clause, actSlug: u.actSlugHint, instruction: u.instructionText, reason: "AI key missing — set ANTHROPIC_API_KEY to locate amendments" }));
    return res.json({ deltas: [], errors: ["AI key missing — cannot locate amendments."], failures, cached: false });
  }

  // 3) Locate each amendment against the real Act (AI + verification tools), then
  //    group the located ops by Act. One shared rate-limit budget aborts the rest.
  const navigators = new Map<string, LawNavigator | null>();
  const ctx: LocatorCtx = {
    navigators,
    loadTree: loadActTree,
    catalog: Object.entries(registry).map(([slug, entry]) => ({ slug, title: entry.title })),
  };
  const aiBudget = createAiBudget();
  const { located, failures, incomplete } = await locateAmendments(units, ctx, aiBudget);

  const bySlug = new Map<string, LocatedOp[]>();
  for (const l of located) { const a = bySlug.get(l.actSlug); if (a) a.push(l); else bySlug.set(l.actSlug, [l]); }

  // 4) Per Act: compute amend text via the grounded scalpel, apply deterministically,
  //    diff, and link each op to the rows it produced.
  const deltas: unknown[] = [];
  for (const [slug, ops] of bySlug) {
    const nav = navigators.get(slug) ?? null;
    const tree: ActTree | null = nav?.tree ?? (await loadActTree(slug));
    if (!tree) { errors.push(`No structured text ingested for ${slug}.`); continue; }

    // Amend ops are in-place edits: feed the verified provision text + the
    // instruction to the scalpel to get the full edited text (the only place the
    // model touches wording, and only on text we already verified).
    const editText = new Map<LocatedOp, string>();
    if (nav) {
      const amendOps = ops.filter((o) => o.op === "amend");
      const tasks: ScalpelTask[] = [];
      const byTaskId = new Map<string, LocatedOp>();
      amendOps.forEach((o, i) => {
        const got = nav.getProvision(o.ancestors);
        if (got.ok) { const id = `a${i}`; tasks.push({ id, kind: "edit", instruction: o.instruction, currentText: got.text }); byTaskId.set(id, o); }
      });
      if (tasks.length) {
        const { results } = await resolveBatch(tree.title, tasks, aiBudget);
        for (const [id, o] of byTaskId) { const r = results.get(id); if (r?.newText) editText.set(o, r.newText); }
      }
    }

    const applyOps: ApplyOp[] = ops.map((o) => ({
      clause: o.clause, op: o.op, ancestors: o.ancestors, instruction: o.instruction,
      confirmed: o.confirmed, inserts: o.inserts, editedText: editText.get(o),
    }));
    const { before, after, applied } = applyOperations(tree, applyOps);
    const rows = diffProvisions(before, after);
    const linked = attachRowLinks(slug, applied, rows);
    const operations = linked.map((o) => ({
      key: o.key,
      clause: o.clause,
      op: o.op,
      ancestors: o.ancestors,
      anchor: composeAnchor(o.ancestors),
      anchorFound: o.located,
      confirmed: o.confirmed,
      count: o.producedRowIndices.length,
      instruction: o.instruction,
      note: o.instruction,
      resolution: "ai" as const,
      producedRowIndices: o.producedRowIndices,
      contextRowIndices: o.contextRowIndices,
    }));
    // Slim the payload for very large Acts (blank far-from-change unchanged text).
    const slimRows = slimUnchangedText(rows, operations);
    deltas.push({ slug, title: tree.title, citation: tree.citation, summary: diffSummary(rows), operations, rows: slimRows, source: "ai-located", outdated: tree.outdated });
  }

  console.log(`[provision-delta] ${bill.billNumber}: ${deltas.length} act(s), ${located.length} located, ${failures.length} unlocatable`);

  // 5) Cache only a COMPLETE run, so a rate-limited one retries next time.
  if (deltas.length > 0 && !incomplete) {
    await upsert(FILES.provisionDeltas, { id: bill.id, deltas, errors, failures, createdAt: new Date().toISOString() });
  }
  res.json({ deltas, errors, failures, cached: false, aiIncomplete: incomplete, aiIncompleteReason: aiBudget.reason, rateLimited: aiBudget.rateLimitHits });
  } catch (err) {
    console.error("[provision-delta]", err instanceof Error ? err.stack : err);
    if (!res.headersSent) {
      res.status(500).json({ deltas: [], errors: [`Delta computation failed: ${err instanceof Error ? err.message : String(err)}`], failures: [], cached: false });
    }
  }
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
