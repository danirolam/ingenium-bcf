// The amendment LOCATOR. Given one bill amendment (its instruction sentence plus
// the provisions it inserts), the model navigates the REAL Act with tools — the
// way a lawyer would: read a provision, list a section's children, search by text
// or marginal note, look up a definition — and returns only an OPERATION and the
// target's ANCESTOR PATH. Every tool answer is grounded in the ingested Act, and
// a deterministic validator gates the final answer, so the model can locate but
// never invent. Statutory text is never written here — it comes from the bill's
// <AmendedText> (carried on the unit).
import type { AmendmentUnit } from "./billAmendments.js";
import type { PositionStep } from "./amendmentEngine.js";
import { compareLabels, LawNavigator, type ActNode, type ActTree } from "./lawTree.js";
import type { AiBudget } from "./aiBudget.js";
import { anthropicMessages } from "./anthropic.js";

const MODEL = process.env.ANTHROPIC_LOCATOR_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
const MAX_HOPS = 14;
const CONCURRENCY = 4; // gentle on the 50k-tok/min limit; the budget aborts the rest

export type LocateOp = "add" | "replace" | "amend" | "repeal";

export interface LocatedOp {
  clause: string;
  op: LocateOp;
  actSlug: string;
  ancestors: PositionStep[];
  confirmed: boolean;
  note: string;
  instruction: string;
  inserts: ActNode[]; // the bill's verbatim content (nested), applied deterministically
}
export interface LocateFailure {
  clause: string;
  actSlug: string | null;
  instruction: string;
  reason: string;
}

export interface LocatorCtx {
  navigators: Map<string, LawNavigator | null>; // slug → navigator cache (null = tried, not ingested)
  loadTree: (slug: string) => Promise<ActTree | null>; // lazily load any ingested Act
  catalog: { slug: string; title: string }[]; // for list_acts (untagged bills)
}

// Lazily load + cache the navigator for an Act, so an untagged clause can reach
// any ingested Act the model names via list_acts without building all of them.
async function getNav(ctx: LocatorCtx, slug: string): Promise<LawNavigator | null> {
  if (ctx.navigators.has(slug)) return ctx.navigators.get(slug) ?? null;
  const tree = await ctx.loadTree(slug);
  const nav = tree ? new LawNavigator(tree) : null;
  ctx.navigators.set(slug, nav);
  return nav;
}

// ── Deterministic validator (shared by the validate_operation tool and the
// authoritative final check) ───────────────────────────────────────────────
interface ValidateResult {
  ok: boolean;
  error?: string;
  available?: string[];
  provision?: { label: string; marginalNote: string | null; text: string };
}
export function validateOp(nav: LawNavigator, op: LocateOp, ancestors: PositionStep[]): ValidateResult {
  if (!ancestors.length) return { ok: false, error: "ancestors path is empty" };
  if (op === "add") {
    const parent = ancestors.slice(0, -1);
    const leaf = ancestors[ancestors.length - 1];
    if (parent.length) {
      const pr = nav.resolve(parent);
      if (!pr.ok) return { ok: false, error: `the parent does not exist: ${pr.reason}`, available: pr.available };
    }
    if (nav.exists(ancestors))
      return { ok: false, error: `${leaf.label} already exists — an add must introduce a new label, not an existing one` };
    // Sort check: the new leaf has a unique, well-defined position among the
    // parent's same-kind children (the comparator is a total order, and we know
    // it doesn't collide), so confirm the kind fits at least one sibling if any.
    const kids = parent.length ? (nav.resolve(parent) as any).node?.children ?? [] : nav.tree.sections;
    const sibs = kids.filter((c: any) => c.kind === leaf.kind);
    const after = sibs.filter((c: any) => compareLabels(leaf.kind, c.num, leaf.label) < 0).pop();
    return {
      ok: true,
      provision: {
        label: leaf.label,
        marginalNote: null,
        text: after ? `inserts after ${after.num}` : sibs.length ? `inserts before ${sibs[0].num}` : "inserts as the first child",
      },
    };
  }
  const r = nav.resolve(ancestors);
  if (!r.ok) return { ok: false, error: r.reason, available: r.available };
  const got = nav.getProvision(ancestors);
  return { ok: true, provision: got.ok ? { label: got.label, marginalNote: got.marginalNote, text: got.text } : undefined };
}

// ── Tools ─────────────────────────────────────────────────────────────────
const ANC = {
  type: "array",
  description: "Ancestor path, root→leaf, e.g. [{kind:'section',label:'30'},{kind:'subsection',label:'1'},{kind:'paragraph',label:'j'}]. A definition is {kind:'definition',label:'<term>'} under its section.",
  items: {
    type: "object",
    properties: { kind: { type: "string" }, label: { type: "string" } },
    required: ["kind", "label"],
  },
};
const TOOLS: any = [
  { name: "list_acts", description: "List the Acts available to navigate (slug + title). Use when you don't know which Act a clause amends.", input_schema: { type: "object", properties: {} } },
  { name: "get_provision", description: "Read the provision at an ancestor path: its text, marginal note, its CHILDREN, and its SIBLINGS (the other provisions at its level, in order — so a range like 'paragraphs (b) to (c)' is visible at a glance) — or the EXACT level that doesn't exist. Use to confirm a target and read what you're replacing/repealing.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, ancestors: ANC }, required: ["actSlug", "ancestors"] } },
  { name: "list_children", description: "List the direct children (label, kind, marginal note) under an ancestor path, or the Act's top-level sections when ancestors is empty. Use to find where an insert belongs or to disambiguate.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, ancestors: ANC }, required: ["actSlug", "ancestors"] } },
  { name: "get_neighbors", description: "Read a provision plus the few provisions immediately before and after it in the Act, for surrounding context.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, ancestors: ANC }, required: ["actSlug", "ancestors"] } },
  { name: "search_text", description: "Find provisions whose text or marginal note contains a phrase. Returns up to 12 {label, marginalNote, snippet}.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, query: { type: "string" } }, required: ["actSlug", "query"] } },
  { name: "search_marginal_notes", description: "Find provisions by their marginal note / heading (the Act's own index). Returns up to 12 {label, marginalNote}.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, query: { type: "string" } }, required: ["actSlug", "query"] } },
  { name: "find_definition", description: "Locate a defined term in the Act. Returns matching definitions {label, snippet}.", input_schema: { type: "object", properties: { actSlug: { type: "string" }, term: { type: "string" } }, required: ["actSlug", "term"] } },
  { name: "validate_operation", description: "Check a candidate {op, actSlug, ancestors} deterministically. For add: confirms the parent exists, the new label doesn't collide, and where it sorts in. For replace/amend/repeal: confirms the target resolves and returns its current text. You MUST get ok:true before finalizing.", input_schema: { type: "object", properties: { op: { type: "string", enum: ["add", "replace", "amend", "repeal"] }, actSlug: { type: "string" }, ancestors: ANC }, required: ["op", "actSlug", "ancestors"] } },
];

async function runTool(ctx: LocatorCtx, name: string, input: any): Promise<unknown> {
  if (name === "list_acts") return { acts: ctx.catalog };
  const slug = String(input?.actSlug ?? "");
  const nav = await getNav(ctx, slug);
  if (!nav) return { error: `no Act '${slug}' is available — call list_acts for valid slugs` };
  const anc = (input?.ancestors ?? []) as PositionStep[];
  switch (name) {
    case "get_provision": return nav.getProvision(anc);
    case "list_children": return nav.listChildren(anc);
    case "get_neighbors": return nav.neighbors(anc);
    case "search_text": return { matches: nav.searchText(String(input?.query ?? "")) };
    case "search_marginal_notes": return { matches: nav.searchMarginalNotes(String(input?.query ?? "")) };
    case "find_definition": return { matches: nav.findDefinition(String(input?.term ?? "")) };
    case "validate_operation": return validateOp(nav, input?.op as LocateOp, anc);
    default: return { error: "unknown tool" };
  }
}

const SYSTEM = `You locate where a single Canadian bill amendment lands in an existing Act. You are given the amendment's instruction text and, when the bill inserts new text, the labels of the provisions it inserts. You must return the OPERATION and the target's ANCESTOR PATH — nothing else. Do NOT write or rewrite statutory text; that comes from the bill.

OPERATIONS (classify by EFFECT, not the bill's wording — bills say "is amended by" for several):
- "add": the bill inserts a brand-new provision. The ancestors are the NEW provision's full path INCLUDING its bill-given leaf label (e.g. inserting "(j.01)" after paragraph (j) of subsection 30(1) → [section 30, subsection 1, paragraph j.01]). The leaf must NOT already exist; its parent MUST exist.
- "replace": the bill substitutes an ENTIRE existing provision with new full text it supplies ("X is replaced by the following:"). The ancestors are the EXISTING provision being replaced.
- "amend": the bill makes a SURGICAL text edit INSIDE an existing provision with NO full replacement ("striking out 'or'", "replacing the expression X with Y"). The ancestors are the EXISTING provision edited.
- "repeal": the bill deletes an existing provision (or a whole section/schedule). The ancestors are the EXISTING provision (or container) removed.

The difference between replace and amend: replace swaps the whole provision (the bill gives the new wording); amend changes a few words in place (the bill gives an edit instruction, not new wording).

RANGES: an instruction can target a span ("Paragraphs 5(1)(b) to (c) are replaced by the following"). Use get_provision (its sibling list shows the full range) to confirm the span, then return a "replace" addressed at the FIRST provision of the range — the bill supplies the complete set of replacement provisions, which are applied across the span.

HOW TO WORK:
1. Identify the Act (use list_acts if it isn't given) and the operation.
2. Resolve the target with the tools — read provisions, list children, search by text or marginal note, look up definitions. Never guess a label you haven't confirmed.
3. Call validate_operation and get ok:true.
4. Read the resolved provision (in validate_operation's reply or via get_provision) and DOUBLE-CHECK it is genuinely what the amendment targets.

Then reply with ONLY strict JSON (no prose, no markdown):
{"op":"add|replace|amend|repeal","actSlug":string,"ancestors":[{"kind":string,"label":string}],"confirmed":true,"note":string}
Set "confirmed":true only after validate_operation returned ok and you verified the provision matches. If you genuinely cannot locate it, reply {"unlocatable":true,"reason":string} explaining what failed.`;

// First balanced {…} object in the text (brace-aware, ignores braces in strings),
// so a stray brace in prose or a trailing token doesn't break parsing.
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

interface Final {
  op?: LocateOp;
  actSlug?: string;
  ancestors?: PositionStep[];
  confirmed?: boolean;
  note?: string;
  unlocatable?: boolean;
  reason?: string;
}

async function locateOne(unit: AmendmentUnit, ctx: LocatorCtx, budget?: AiBudget): Promise<LocatedOp | LocateFailure> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const collect = (nodes: ActNode[], out: string[] = []): string[] => {
    for (const n of nodes) { if (n.num) out.push(`${n.kind} ${n.num}`); collect(n.children ?? [], out); }
    return out;
  };
  const insertLabels = collect(unit.inserts).slice(0, 30);
  const user =
    `AMENDMENT (clause ${unit.clause}):\n${unit.instructionText}\n\n` +
    (unit.actSlugHint ? `Likely Act slug: ${unit.actSlugHint}\n` : `Act not tagged — use list_acts.\n`) +
    (insertLabels.length ? `Bill inserts these provisions (labels): ${insertLabels.join("; ")}` : `The bill inserts no new provision (a repeal or in-place edit).`);
  const messages: any[] = [{ role: "user", content: user }];
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const tag = `[locator] cl${unit.clause} ${unit.actSlugHint ?? "?"}`;
  console.log(`${tag}: "${unit.instructionText.replace(/\s+/g, " ").slice(0, 80)}"`);
  const fail = (reason: string): LocateFailure => {
    console.log(`${tag} ✗ ${reason} (${secs()}s)`);
    return { clause: unit.clause, actSlug: unit.actSlugHint, instruction: unit.instructionText, reason };
  };

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (budget?.signal.aborted) return fail("interrupted (rate limit) before locating");
      const body: any = { model: MODEL, max_tokens: 1500, temperature: 0, system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], tools: TOOLS, messages };
      if (hop === MAX_HOPS) body.tool_choice = { type: "none" };
      const res = await anthropicMessages(body, key, budget, tag);
      if (!res.ok) {
        budget?.trip(res.status === 429 ? "rate-limit" : "ai-error");
        return fail(`AI request failed (${res.status})`);
      }
      const data = await res.json();
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        const text = (data.content.find((b: any) => b.type === "text")?.text as string) ?? "";
        const json = extractJson(text);
        let parsed: Final | null = null;
        if (json) try { parsed = JSON.parse(json); } catch { /* malformed */ }
        if (!parsed) {
          // Re-prompt for clean JSON rather than fail on a transient formatting slip.
          if (hop < MAX_HOPS) { messages.push({ role: "user", content: "Reply with ONLY the JSON decision object — no prose, no markdown fences." }); continue; }
          return fail("no parseable decision JSON");
        }
        if (parsed.unlocatable) return fail(parsed.reason || "model could not locate the amendment");
        // The slug is usually obvious from the tagged Act — fill it from the hint
        // when the model omits it.
        if (!parsed.actSlug && unit.actSlugHint) parsed.actSlug = unit.actSlugHint;
        if (!parsed.op || !parsed.actSlug || !Array.isArray(parsed.ancestors)) {
          // A transient incomplete decision (seen occasionally on large blocks) —
          // re-prompt for the full object rather than dropping the amendment.
          if (hop < MAX_HOPS) {
            messages.push({ role: "user", content: `Your decision is incomplete — it MUST include "op", "actSlug", and an "ancestors" array. Reply again with the complete JSON decision object only.` });
            continue;
          }
          return fail("decision missing op/actSlug/ancestors");
        }
        const nav = await getNav(ctx, parsed.actSlug);
        if (!nav) return fail(`model named an unavailable Act '${parsed.actSlug}'`);
        // Authoritative re-validation — the model's confirmation is not trusted.
        const v = validateOp(nav, parsed.op, parsed.ancestors);
        if (!v.ok) {
          // Feed the failure back once so it can self-correct, then give up.
          if (hop < MAX_HOPS - 1) {
            messages.push({ role: "user", content: `Your answer failed validation: ${v.error}${v.available ? ` (present here: ${v.available.join(", ")})` : ""}. Fix the ancestors and reply again.` });
            continue;
          }
          return fail(`validation failed: ${v.error}`);
        }
        console.log(`${tag} ✓ ${parsed.op.toUpperCase()} ${parsed.actSlug} ${parsed.ancestors.map((a) => a.label).join("/")} ${parsed.confirmed ? "confirmed" : "unconfirmed"} (${hop + 1} hops, ${secs()}s)`);
        return {
          clause: unit.clause,
          op: parsed.op,
          actSlug: parsed.actSlug,
          ancestors: parsed.ancestors,
          confirmed: parsed.confirmed === true,
          note: parsed.note ?? "",
          instruction: unit.instructionText,
          inserts: unit.inserts,
        };
      }

      // Execute tool calls (each may lazily load an Act), reply with one tool_result each.
      const toolUses = data.content.filter((b: any) => b.type === "tool_use");
      console.log(`${tag} hop${hop}: ${toolUses.map((b: any) => `${b.name}(${b.input?.ancestors ? b.input.ancestors.map((a: any) => a.label).join("/") : b.input?.query ?? b.input?.term ?? ""})`).join(", ")}`);
      const toolResults = await Promise.all(
        toolUses.map(async (block: any) => ({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(await runTool(ctx, block.name, block.input)) })),
      );
      messages.push({ role: "user", content: toolResults });
    }
    return fail("ran out of reasoning steps without a decision");
  } catch (err: any) {
    if (budget && !budget.signal.aborted) budget.trip("ai-error");
    return fail(`locator error: ${err?.message ?? err}`);
  }
}

// Locate every amendment unit (bounded concurrency). Failures are collected, not
// thrown — an unlocatable amendment is surfaced in the UI, never mis-placed.
export async function locateAmendments(
  units: AmendmentUnit[],
  ctx: LocatorCtx,
  budget?: AiBudget,
): Promise<{ located: LocatedOp[]; failures: LocateFailure[]; incomplete: boolean }> {
  // Results are stored BY INPUT INDEX, not completion order, so the amendments
  // stay in document order (the units are extracted in document order) regardless
  // of which AI call finishes first.
  const results: (LocatedOp | LocateFailure)[] = new Array(units.length);
  let i = 0;
  const worker = async () => {
    while (i < units.length) {
      const idx = i++;
      results[idx] = await locateOne(units[idx], ctx, budget);
    }
  };
  console.log(`[locator] locating ${units.length} amendment(s), concurrency ${Math.min(CONCURRENCY, units.length)}…`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, units.length) }, worker));
  const located = results.filter((r): r is LocatedOp => !!r && "op" in r);
  const failures = results.filter((r): r is LocateFailure => !!r && !("op" in r));
  console.log(`[locator] done: ${located.length}/${units.length} located, ${failures.length} failed${budget?.reason ? ` (incomplete: ${budget.reason})` : ""}`);
  return { located, failures, incomplete: budget?.reason != null };
}
