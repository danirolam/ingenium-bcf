import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProvisionDeltaResult } from "./api";
import type { AmendmentFailure, Bill, ProvisionDelta } from "../types";

export interface ProvisionDeltaState {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  errors: string[];
  /** Amendments the locator couldn't place — shown subtly, never dropped. */
  failures: AmendmentFailure[];
  /** The server logs from this run, verbatim, for the Inspect panel. */
  logs: string[];
  cached: boolean;
  /** An AI call was cut short (rate limit / failure) so the result may be partial. */
  incomplete: boolean;
  incompleteReason: "rate-limit" | "ai-error" | null;
  /** Times the AI was rate-limited and auto-retried (0 = never). */
  rateLimited: number;
  /** First load, before any data is shown. */
  loading: boolean;
  /** A recompute is in flight while existing data stays on screen. */
  refreshing: boolean;
  /** Force a server recompute (?refresh=1). */
  recompute: () => void;
}

// The single owner of the grounded provision-delta for a bill. Fetches the bill
// and its delta, re-fetches on bill change, and exposes a recompute() that forces
// the server to re-interpret. Nothing else talks to the delta endpoint.
export function useProvisionDelta(billId: string | null): ProvisionDeltaState {
  const [bill, setBill] = useState<Bill | null>(null);
  const [deltas, setDeltas] = useState<ProvisionDelta[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [failures, setFailures] = useState<AmendmentFailure[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [cached, setCached] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [incompleteReason, setIncompleteReason] = useState<"rate-limit" | "ai-error" | null>(null);
  const [rateLimited, setRateLimited] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // recompute() flips this ref then bumps `nonce` to re-run the effect with force.
  const forceRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const recompute = useCallback(() => {
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!billId) {
      setBill(null); setDeltas([]); setErrors([]); setFailures([]); setLogs([]); setRateLimited(0);
      setLoading(false); setRefreshing(false);
      return;
    }
    const ac = new AbortController();
    const { signal } = ac;
    const forced = forceRef.current;
    forceRef.current = false;
    if (forced) setRefreshing(true);
    else setLoading(true);

    (async () => {
      const b = await api.bills.get(billId, signal).catch(() => null);
      if (signal.aborted) return;
      setBill(b);
      // A forced recompute STREAMS its server logs so the Inspect panel fills live
      // (the AI's steps appear one by one); a plain load just fetches the result.
      let res: ProvisionDeltaResult | null;
      if (forced) {
        setLogs([]);
        res = await api.bills
          .provisionDeltaStream(billId, (line) => setLogs((prev) => [...prev, line]), signal)
          .catch(() => null);
      } else {
        res = await api.bills.provisionDelta(billId, false, signal).catch(() => null);
      }
      if (signal.aborted) return;
      if (res) {
        setDeltas(res.deltas ?? []);
        setErrors(res.errors ?? []);
        setFailures(res.failures ?? []);
        setLogs(res.logs ?? []);
        setCached(!!res.cached);
        setIncomplete(!!res.aiIncomplete);
        setIncompleteReason(res.aiIncompleteReason ?? null);
        setRateLimited(res.rateLimited ?? 0);
      }
      setLoading(false); setRefreshing(false);
    })().catch((e) => {
      if (e?.name === "AbortError") return;
      setLoading(false); setRefreshing(false);
    });

    return () => ac.abort();
    // forceRef is read, not a dep; nonce drives forced re-runs.
  }, [billId, nonce]);

  return { bill, deltas, errors, failures, logs, cached, incomplete, incompleteReason, rateLimited, loading, refreshing, recompute };
}
