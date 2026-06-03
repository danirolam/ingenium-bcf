// The "scalpel": one batched Haiku call that resolves the small, well-scoped
// jobs the deterministic pass couldn't finish — applying a partial in-provision
// edit, or locating where an unmatched anchor belongs. All tasks for one bill×Act
// go in a SINGLE request (cheap, rate-limit friendly); outputs are short.
import type { AiBudget } from "./aiBudget.js";

const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_SCALPEL_MODEL || "claude-haiku-4-5";

// Each "edit" task makes the model echo back the FULL edited provision, so the
// binding limit is the 8000-token output cap, not the input. Budget a batch's
// task text well under that so a bill with many (or large) partial edits is
// split across requests instead of overflowing one.
const MAX_OUTPUT_TOKENS = 8000;
const TASK_BATCH_TOKENS = 6000;
const estTokens = (s: string) => Math.ceil(s.length / 4); // rough chars→tokens

const SYSTEM = `You help apply Canadian legislative amendments. You receive a JSON list of small tasks for ONE Act and must return STRICT JSON: {"results":[{"id": string, "newText"?: string, "resolvedLabel"?: string|null}]}.

For a task with kind "edit": apply the instruction to currentText and return, in "newText", the FULL edited provision text — identical to currentText except for exactly what the instruction changes. No commentary, no markdown.
For a task with kind "locate": choose which candidate label the instruction refers to and return it in "resolvedLabel" (or null if none fit).

Return exactly one result object per task id. Output JSON only.`;

export interface EditTask {
  id: string;
  kind: "edit";
  instruction: string;
  currentText: string;
}
export interface LocateTask {
  id: string;
  kind: "locate";
  instruction: string;
  candidates: { label: string; snippet: string }[];
}
export type ScalpelTask = EditTask | LocateTask;
export interface ScalpelResult { id: string; newText?: string; resolvedLabel?: string | null }

export async function resolveBatch(
  actTitle: string,
  tasks: ScalpelTask[],
  budget?: AiBudget,
): Promise<{ results: Map<string, ScalpelResult>; incomplete: boolean }> {
  const out = new Map<string, ScalpelResult>();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || tasks.length === 0) return { results: out, incomplete: false };

  // Pack tasks into batches under the output budget; a single oversized task
  // still gets its own request (the model just can't echo more than max_tokens).
  const batches: ScalpelTask[][] = [];
  let cur: ScalpelTask[] = [];
  let tok = 0;
  for (const t of tasks) {
    const tt = estTokens(JSON.stringify(t));
    if (cur.length && tok + tt > TASK_BATCH_TOKENS) { batches.push(cur); cur = []; tok = 0; }
    cur.push(t);
    tok += tt;
  }
  if (cur.length) batches.push(cur);
  if (batches.length > 1) console.log(`[scalpel] ${actTitle}: ${tasks.length} tasks → ${batches.length} batches`);

  // Stop at the first failed/aborted batch and report incomplete; partial
  // results already in `out` are kept.
  let incomplete = false;
  for (const batch of batches) {
    if (budget?.signal.aborted) { incomplete = true; break; }
    const ok = await sendBatch(key, actTitle, batch, out, budget);
    if (!ok) { incomplete = true; break; }
  }
  return { results: out, incomplete };
}

async function sendBatch(
  key: string,
  actTitle: string,
  tasks: ScalpelTask[],
  out: Map<string, ScalpelResult>,
  budget?: AiBudget,
): Promise<boolean> {
  const body = {
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0, // deterministic: locating anchors / applying edits must be consistent
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `ACT: ${actTitle}\n\nTASKS (JSON):\n${JSON.stringify(tasks)}` }],
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
      console.log(`[scalpel] ${res.status} ${await res.text()}`);
      return false;
    }
    const data = await res.json();
    const text = (data.content?.find((b: any) => b.type === "text")?.text as string) ?? "";
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return true; // no parseable output, but the request itself was fine
    const parsed = JSON.parse(json[0]) as { results?: ScalpelResult[] };
    for (const r of parsed.results ?? []) out.set(r.id, r);
    return true;
  } catch (err: any) {
    // AbortError = a sibling tripped the budget; anything else is a real failure.
    if (budget && !budget.signal.aborted) budget.trip("ai-error");
    console.log(`[scalpel] failed: ${err?.message ?? err}`);
    return false;
  }
}
