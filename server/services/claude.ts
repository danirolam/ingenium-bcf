// Anthropic Messages API interpreter (raw fetch — no SDK, matching the
// dep-light codebase). Same job as the Gemini tooled interpreter: the model
// reads a bill's clauses and calls look_up_provision/search_provisions to fetch
// the exact Act sections it needs, then returns structured operations. The Act
// is NOT sent up front — tools fetch provisions on demand, so this scales to
// any Act size and grounds anchors against text the model actually retrieved.
import type { Bill, BillClause } from "../../src/types.js";
import { normLabel, type Amendment, type Provision } from "./amendmentEngine.js";
import type { AiBudget } from "./aiBudget.js";

const API = "https://api.anthropic.com/v1/messages";
// Haiku is fast and cheap — this is mechanical extraction, not deep reasoning.
// Override with ANTHROPIC_MODEL (e.g. claude-sonnet-4-6) if you want more depth.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const MAX_HOPS = 18;
// The bill is the size driver: some omnibus bills (e.g. C-31) run >250k tokens
// of clause text, which would blow the context window in one request. So we
// split the clauses into batches that each stay well under our ~50k-token
// request budget and interpret them separately, then merge the operations. The
// Act is never sent up front (tools fetch provisions on demand), so only the
// bill text needs bounding here. ~35k leaves headroom for the system prompt,
// tools, and the provisions the model looks up over its hops.
const BILL_BATCH_TOKENS = 35_000;
const estTokens = (s: string) => Math.ceil(s.length / 4); // rough chars→tokens

const SYSTEM = `You extract how a bill amends an existing Act, as structured operations. Use the tools to locate and read the exact provisions the bill references — never guess a label.

When finished, reply with ONLY strict JSON (no prose, no markdown fences):
{"operations":[{"clause":string,"op":"add"|"replace"|"repeal"|"amend","anchor":string|null,"position":"after"|"before"|"replaces"|"within"|null,"newLabel":string|null,"newMarginalNote":string|null,"newText":string|null,"note":string}]}

Rules:
- "anchor" must be a real provision label you confirmed with a tool (or null only for a brand-new Part with no in-Act anchor).
- "newText" = the verbatim inserted/replacement statutory text from the bill (omit the instruction phrasing like "The Act is amended by adding...").
- One operation per discrete change.
- Be economical: look up several provisions in a single turn, and do NOT re-verify a provision you have already seen. As soon as you have confirmed the anchors you need, STOP calling tools and output the JSON.`;

const TOOLS: any = [
  {
    name: "look_up_provision",
    description:
      "Return the current wording of a provision in the Act by its label (e.g. '30', '30(1)', '2.4'). Call this to confirm an anchor exists and to read text you must replace or amend.",
    input_schema: {
      type: "object",
      properties: { label: { type: "string", description: "Provision label, e.g. 30(1)(a)" } },
      required: ["label"],
    },
  },
  {
    name: "search_provisions",
    description:
      "Find provisions whose label or marginal note contains the query. Returns up to 10 {label, marginalNote}. Use when you don't know the exact label.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    cache_control: { type: "ephemeral" }, // caches tools + system prefix (stable across bills)
  },
];

export async function interpretAmendmentsClaude(args: {
  bill: Bill;
  actTitle: string;
  provisions: Provision[];
}, budget?: AiBudget): Promise<{ operations: Amendment[]; incomplete: boolean } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const byLabel = new Map<string, Provision>();
  for (const p of args.provisions) byLabel.set(normLabel(p.label), p);

  // Split the bill's clauses into request-sized batches so a huge bill (e.g.
  // C-31) never sends more than the budget of clause text in a single request.
  const batches = batchClauses(args.bill.clauses);
  if (batches.length > 1) {
    console.log(
      `[claude] ${args.actTitle}: ${args.bill.clauses.length} clauses → ${batches.length} ` +
      `batches (≤${BILL_BATCH_TOKENS} tok each)`,
    );
  }

  // Interpret each batch independently and merge. If a call fails (rate limit
  // or otherwise) we stop here and return whatever operations we did get,
  // flagged incomplete — the budget's abort also stops sibling Acts.
  const operations: Amendment[] = [];
  let anyOk = false;
  let incomplete = false;
  for (let b = 0; b < batches.length; b++) {
    if (budget?.signal.aborted) { incomplete = true; break; } // a sibling tripped the limit
    const res = await runInterpretLoop(key, byLabel, args.provisions, args.actTitle, batches[b], `${b + 1}/${batches.length}`, budget);
    if (res.operations.length) { operations.push(...res.operations); anyOk = true; }
    if (res.failed) { incomplete = true; break; } // stop remaining batches
  }
  return anyOk || incomplete ? { operations, incomplete } : null;
}

// Group clause lines into batches under the per-request token budget. A single
// clause larger than the whole budget is truncated (head + tail) so its anchor
// and the endpoints of its inserted text still reach the model.
function batchClauses(clauses: BillClause[]): string[][] {
  const line = (c: BillClause) =>
    `Clause ${c.number ?? ""}: ${(c.heading ?? "") + " " + c.text}`.trim();
  const cap = (s: string) => {
    const max = BILL_BATCH_TOKENS * 4; // budget in chars
    if (s.length <= max) return s;
    return `${s.slice(0, Math.floor(max * 0.7))}\n…[clause truncated: ${s.length} chars]…\n${s.slice(-Math.floor(max * 0.25))}`;
  };
  const batches: string[][] = [];
  let cur: string[] = [];
  let tok = 0;
  for (const c of clauses) {
    const text = cap(line(c));
    const t = estTokens(text);
    if (cur.length && tok + t > BILL_BATCH_TOKENS) { batches.push(cur); cur = []; tok = 0; }
    cur.push(text);
    tok += t;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// One tool-use interpretation loop over a single batch of clause lines.
// `failed` means a request errored (rate limit / non-200 / aborted) and the
// caller should stop; `operations` carries whatever was parsed before that.
async function runInterpretLoop(
  key: string,
  byLabel: Map<string, Provision>,
  provisions: Provision[],
  actTitle: string,
  clauseLines: string[],
  batchLabel: string,
  budget?: AiBudget,
): Promise<{ operations: Amendment[]; failed?: boolean }> {
  const messages: any[] = [
    { role: "user", content: `ACT BEING AMENDED: ${actTitle}\n\nBILL CLAUSES:\n${clauseLines.join("\n\n")}` },
  ];

  const t0 = Date.now();
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const hopStart = Date.now();
      // On the final hop, disable tools so the model MUST produce the JSON
      // instead of looking up yet another provision and running out of budget.
      const body: any = { model: MODEL, max_tokens: 16000, system: SYSTEM, tools: TOOLS, messages };
      if (hop === MAX_HOPS) body.tool_choice = { type: "none" };
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: budget?.signal,
      });
      if (!res.ok) {
        // 429 = rate limit; trip the shared budget so sibling Acts stop too.
        budget?.trip(res.status === 429 ? "rate-limit" : "ai-error");
        console.log(`[claude] ${actTitle} batch ${batchLabel} ${res.status} ${await res.text()}`);
        return { operations: [], failed: true };
      }
      const data = await res.json();
      const nCalls = (data.content ?? []).filter((b: any) => b.type === "tool_use").length;
      console.log(
        `[claude] ${actTitle} batch ${batchLabel} hop ${hop}: ${data.stop_reason}, ${nCalls} tool calls, ` +
        `${Math.round((Date.now() - hopStart) / 1000)}s (total ${Math.round((Date.now() - t0) / 1000)}s), ` +
        `out=${data.usage?.output_tokens}`,
      );

      // Preserve the assistant turn verbatim (tool_use blocks must round-trip).
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        const text = (data.content.find((b: any) => b.type === "text")?.text as string) ?? "";
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return { operations: [] };
        try { return { operations: (JSON.parse(m[0]) as { operations: Amendment[] }).operations }; }
        catch { return { operations: [] }; } // malformed JSON ≠ a request failure
      }

      // Execute every tool call this turn, reply with one tool_result each.
      const toolResults = data.content
        .filter((b: any) => b.type === "tool_use")
        .map((block: any) => {
          let content: string;
          if (block.name === "look_up_provision") {
            const p = byLabel.get(normLabel(String(block.input?.label ?? "")));
            content = p
              ? JSON.stringify({ found: true, label: p.label, marginalNote: p.marginalNote, text: p.text })
              : JSON.stringify({ found: false });
          } else if (block.name === "search_provisions") {
            const q = String(block.input?.query ?? "").toLowerCase();
            content = JSON.stringify({
              matches: provisions
                .filter((p) => `${p.label} ${p.marginalNote ?? ""}`.toLowerCase().includes(q))
                .slice(0, 10)
                .map((p) => ({ label: p.label, marginalNote: p.marginalNote })),
            });
          } else {
            content = JSON.stringify({ error: "unknown tool" });
          }
          return { type: "tool_result", tool_use_id: block.id, content };
        });

      messages.push({ role: "user", content: toolResults });
    }
    return { operations: [] }; // ran out of hops without a final answer — not a failure
  } catch (err: any) {
    // AbortError = a sibling tripped the budget; anything else is a real failure.
    if (budget && !budget.signal.aborted) budget.trip("ai-error");
    console.log(`[claude] interpret failed (batch ${batchLabel}): ${err?.message ?? err}`);
    return { operations: [], failed: true };
  }
}
