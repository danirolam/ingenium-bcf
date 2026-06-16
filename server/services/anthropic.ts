// One POST to the Anthropic Messages API, with exponential backoff on HTTP 429
// (rate limit) so a transient per-minute cap self-heals instead of dropping work.
// Each backoff is counted on the shared budget (for the UI) and logged. After the
// retries are exhausted the final 429 Response is returned, and the caller decides
// to trip the budget (degrade to a partial result).
import type { AiBudget } from "./aiBudget.js";

const API = "https://api.anthropic.com/v1/messages";
const MAX_RETRIES = 5;
const CAP_MS = 20_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export async function anthropicMessages(
  body: unknown,
  key: string,
  budget?: AiBudget,
  tag = "[ai]",
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (budget?.signal.aborted) throw new DOMException("aborted", "AbortError");
    const res = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: budget?.signal,
    });
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    budget?.noteRateLimit();
    // Honour Retry-After when present, else exponential backoff with jitter.
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(CAP_MS, 800 * 2 ** attempt) + Math.floor(Math.random() * 400);
    console.log(`${tag} 429 rate-limited — backing off ${Math.round(wait)}ms (retry ${attempt + 1}/${MAX_RETRIES})`);
    await sleep(wait, budget?.signal);
  }
}
