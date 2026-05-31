// Anthropic Messages API interpreter (raw fetch — no SDK, matching the
// dep-light codebase). Same job as the Gemini tooled interpreter: the model
// reads a bill's clauses and calls look_up_provision/search_provisions to fetch
// the exact Act sections it needs, then returns structured operations. The Act
// is NOT sent up front — tools fetch provisions on demand, so this scales to
// any Act size and grounds anchors against text the model actually retrieved.
import type { Bill } from "../../src/types.js";
import { normLabel, type Amendment, type Provision } from "./amendmentEngine.js";

const API = "https://api.anthropic.com/v1/messages";
// Haiku is fast and cheap — this is mechanical extraction, not deep reasoning.
// Override with ANTHROPIC_MODEL (e.g. claude-sonnet-4-6) if you want more depth.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

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
}): Promise<{ operations: Amendment[] } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const byLabel = new Map<string, Provision>();
  for (const p of args.provisions) byLabel.set(normLabel(p.label), p);

  const clauseText = args.bill.clauses
    .map((c) => `Clause ${c.number ?? ""}: ${(c.heading ?? "") + " " + c.text}`.trim())
    .join("\n\n");

  const messages: any[] = [
    { role: "user", content: `ACT BEING AMENDED: ${args.actTitle}\n\nBILL CLAUSES:\n${clauseText}` },
  ];

  const t0 = Date.now();
  const MAX_HOPS = 18;
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
      });
      if (!res.ok) {
        console.log(`[claude] ${res.status} ${await res.text()}`);
        return null;
      }
      const data = await res.json();
      const nCalls = (data.content ?? []).filter((b: any) => b.type === "tool_use").length;
      console.log(
        `[claude] ${args.actTitle} hop ${hop}: ${data.stop_reason}, ${nCalls} tool calls, ` +
        `${Math.round((Date.now() - hopStart) / 1000)}s (total ${Math.round((Date.now() - t0) / 1000)}s), ` +
        `out=${data.usage?.output_tokens}`,
      );

      // Preserve the assistant turn verbatim (tool_use blocks must round-trip).
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        const text = (data.content.find((b: any) => b.type === "text")?.text as string) ?? "";
        const json = text.match(/\{[\s\S]*\}/);
        return json ? (JSON.parse(json[0]) as { operations: Amendment[] }) : null;
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
              matches: args.provisions
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
    return null;
  } catch (err: any) {
    console.log(`[claude] interpret failed: ${err?.message ?? err}`);
    return null;
  }
}
