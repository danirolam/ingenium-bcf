// The "formatter" — the second step of the stage-2 pipeline. The extractor (the
// deterministic parser / scalpel / interpreter) produces each amended provision's
// text as one run-on blob, e.g. "136.1 (1) … (2) … (3) …". This agent re-lays it
// out the way it appears in the statute: the chapeau, then each subsection (1)/(2),
// paragraph (a)/(b), subparagraph (i)/(ii) on its own indented line.
//
// HARD RULE (the user's): it must NOT change content — only insert structure. The
// model is told so, and a word-preservation guard ENFORCES it: if the line text
// (whitespace stripped) doesn't equal the input exactly, the result is discarded
// and the provision stays flat. So the worst case is "no formatting", never a
// reworded statute. One batched call per delta; shares the request's AiBudget.
import type { AiBudget } from "./aiBudget.js";

const API = "https://api.anthropic.com/v1/messages";
// Override with ANTHROPIC_FORMAT_MODEL; else the shared model. Mechanical layout.
const MODEL = process.env.ANTHROPIC_FORMAT_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const MAX_OUTPUT_TOKENS = 8000;
// Output (lines + JSON) runs larger than the input text, so keep the batch input
// well under the output cap.
const TASK_BATCH_TOKENS = 4000;
const estTokens = (s: string) => Math.ceil(s.length / 4);

const SYSTEM = `You re-lay-out Canadian statutory provisions into the lines they occupy in the Act, for display only. You receive a JSON list of items {id, text} and must return STRICT JSON: {"results":[{"id": string, "lines":[{"depth": number, "text": string}]}]}.

Split each provision into its structural units, one per line:
- depth 0 = the section/chapeau (and any leading number like "136.1");
- depth 1 = a subsection "(1)", "(2)", …;
- depth 2 = a paragraph "(a)", "(b)", …;
- depth 3 = a subparagraph "(i)", "(ii)", …; and so on.
A marker that BEGINS a unit starts a new line at its depth. A marker that is a CROSS-REFERENCE inside a sentence (e.g. "for the purposes of paragraph (1)(a)") is NOT a new line — leave it inline.

ABSOLUTE RULE: preserve the wording EXACTLY. Concatenating your lines' text in order, ignoring whitespace, must reproduce the input character-for-character. Do NOT summarize, paraphrase, translate, renumber, add, or remove anything — you only insert line breaks and assign depths. Output JSON only.`;

export interface FormatItem {
  id: string;
  text: string;
}
export interface ProvLine {
  depth: number;
  text: string;
}

// Whitespace-stripped equality: the formatter may only add line breaks/indents,
// so removing ALL whitespace from both sides must leave them identical. Any
// changed/added/dropped character (word or punctuation) fails the guard.
const stripWs = (s: string) => (s ?? "").replace(/\s+/g, "");
function preservesWording(input: string, lines: ProvLine[]): boolean {
  return stripWs(input) === stripWs(lines.map((l) => l.text).join(" "));
}

export async function formatProvisions(
  items: FormatItem[],
  budget?: AiBudget,
): Promise<{ lines: Map<string, ProvLine[]>; incomplete: boolean }> {
  const out = new Map<string, ProvLine[]>();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || items.length === 0) return { lines: out, incomplete: false };

  // Pack items into batches under the input budget (output is bigger).
  const batches: FormatItem[][] = [];
  let cur: FormatItem[] = [];
  let tok = 0;
  for (const it of items) {
    const tt = estTokens(JSON.stringify(it));
    if (cur.length && tok + tt > TASK_BATCH_TOKENS) {
      batches.push(cur);
      cur = [];
      tok = 0;
    }
    cur.push(it);
    tok += tt;
  }
  if (cur.length) batches.push(cur);
  if (batches.length > 1) console.log(`[format] ${items.length} provisions → ${batches.length} batches`);

  let incomplete = false;
  for (const batch of batches) {
    if (budget?.signal.aborted) {
      incomplete = true;
      break;
    }
    const ok = await sendBatch(key, batch, out, budget);
    if (!ok) {
      incomplete = true;
      break;
    }
  }
  return { lines: out, incomplete };
}

async function sendBatch(
  key: string,
  items: FormatItem[],
  out: Map<string, ProvLine[]>,
  budget?: AiBudget,
): Promise<boolean> {
  const body = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `PROVISIONS (JSON):\n${JSON.stringify(items)}` }],
  };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: budget?.signal,
    });
    if (!res.ok) {
      budget?.trip(res.status === 429 ? "rate-limit" : "ai-error");
      console.log(`[format] ${res.status} ${await res.text()}`);
      return false;
    }
    const data = await res.json();
    const text = (data.content?.find((b: any) => b.type === "text")?.text as string) ?? "";
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return true; // no parseable output, but the request itself was fine
    const parsed = JSON.parse(json[0]) as { results?: { id?: string; lines?: { depth?: number; text?: string }[] }[] };
    const byId = new Map(items.map((it) => [it.id, it.text] as const));
    for (const r of parsed.results ?? []) {
      if (!r || typeof r.id !== "string" || !Array.isArray(r.lines)) continue;
      const lines: ProvLine[] = r.lines
        .filter((l) => l && typeof l.text === "string")
        .map((l) => ({ depth: Math.max(0, Math.floor(Number(l.depth) || 0)), text: String(l.text) }));
      const input = byId.get(r.id);
      // Guard: only accept layout-only output. Need >1 line to be worth it.
      if (input !== undefined && lines.length > 1 && preservesWording(input, lines)) out.set(r.id, lines);
    }
    return true;
  } catch (err: any) {
    if (budget && !budget.signal.aborted) budget.trip("ai-error");
    console.log(`[format] failed: ${err?.message ?? err}`);
    return false;
  }
}
