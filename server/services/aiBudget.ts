// Shared abort/incomplete coordination for all the Anthropic calls behind a
// single provision-delta request. The Messages API has a per-minute rate limit,
// so a 429 is first handled by exponential backoff (see anthropic.ts) — each
// backoff is counted via noteRateLimit() so the UI can show it happened. Only a
// non-recoverable failure (or a 429 that survives every retry) trips the budget:
// the shared AbortSignal cancels in-flight sibling fetches and pending work, and
// the route returns whatever it has, tagged with the reason.
export type AiIncompleteReason = "rate-limit" | "ai-error";

export interface AiBudget {
  readonly signal: AbortSignal;
  readonly reason: AiIncompleteReason | null;
  /** How many times a call was rate-limited and backed off (recovered or not). */
  readonly rateLimitHits: number;
  trip(reason: AiIncompleteReason): void;
  noteRateLimit(): void;
}

export function createAiBudget(): AiBudget {
  const ctrl = new AbortController();
  let reason: AiIncompleteReason | null = null;
  let rateLimitHits = 0;
  return {
    signal: ctrl.signal,
    get reason() {
      return reason;
    },
    get rateLimitHits() {
      return rateLimitHits;
    },
    trip(r) {
      if (ctrl.signal.aborted) return; // first trip wins (keep the original cause)
      reason = r;
      ctrl.abort();
    },
    noteRateLimit() {
      rateLimitHits++;
    },
  };
}
