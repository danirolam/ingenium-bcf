// The "scalpel": one batched Haiku call that resolves the small, well-scoped
// jobs the deterministic pass couldn't finish — applying a partial in-provision
// edit, or locating where an unmatched anchor belongs. All tasks for one bill×Act
// go in a SINGLE request (cheap, rate-limit friendly); outputs are short.
const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_SCALPEL_MODEL || "claude-haiku-4-5";

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
): Promise<Map<string, ScalpelResult>> {
  const out = new Map<string, ScalpelResult>();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || tasks.length === 0) return out;

  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `ACT: ${actTitle}\n\nTASKS (JSON):\n${JSON.stringify(tasks)}` }],
  };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.log(`[scalpel] ${res.status} ${await res.text()}`);
      return out;
    }
    const data = await res.json();
    const text = (data.content?.find((b: any) => b.type === "text")?.text as string) ?? "";
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) return out;
    const parsed = JSON.parse(json[0]) as { results?: ScalpelResult[] };
    for (const r of parsed.results ?? []) out.set(r.id, r);
    return out;
  } catch (err: any) {
    console.log(`[scalpel] failed: ${err?.message ?? err}`);
    return out;
  }
}
