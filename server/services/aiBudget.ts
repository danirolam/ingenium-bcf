// Shared abort/incomplete coordination for all the Anthropic calls behind a
// single provision-delta request. The Messages API has a 50k-token/minute rate
// limit, so once ANY call hits it (or otherwise fails), we trip the budget: the
// shared AbortSignal cancels in-flight sibling fetches and pending batches/Acts
// skip their calls. The route then returns whatever it already computed, tagged
// with the reason, instead of hammering the limit or failing wholesale.
export type AiIncompleteReason = "rate-limit" | "ai-error";

export interface AiBudget {
  readonly signal: AbortSignal;
  readonly reason: AiIncompleteReason | null;
  trip(reason: AiIncompleteReason): void;
}

export function createAiBudget(): AiBudget {
  const ctrl = new AbortController();
  let reason: AiIncompleteReason | null = null;
  return {
    signal: ctrl.signal,
    get reason() {
      return reason;
    },
    trip(r) {
      if (ctrl.signal.aborted) return; // first trip wins (keep the original cause)
      reason = r;
      ctrl.abort();
    },
  };
}
