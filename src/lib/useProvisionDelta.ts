import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Bill, ProvisionDelta } from "../types";

export interface ProvisionDeltaState {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  errors: string[];
  cached: boolean;
  /** An AI call was cut short (rate limit / failure) so the result may be partial. */
  incomplete: boolean;
  incompleteReason: "rate-limit" | "ai-error" | null;
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
  const [cached, setCached] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [incompleteReason, setIncompleteReason] = useState<"rate-limit" | "ai-error" | null>(null);
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
      setBill(null); setDeltas([]); setErrors([]);
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
      const res = await api.bills.provisionDelta(billId, forced, signal).catch(() => null);
      if (signal.aborted) return;
      if (res) {
        setDeltas(res.deltas ?? []);
        setErrors(res.errors ?? []);
        setCached(!!res.cached);
        setIncomplete(!!res.aiIncomplete);
        setIncompleteReason(res.aiIncompleteReason ?? null);
      }
      setLoading(false); setRefreshing(false);
    })().catch((e) => {
      if (e?.name === "AbortError") return;
      setLoading(false); setRefreshing(false);
    });

    return () => ac.abort();
    // forceRef is read, not a dep; nonce drives forced re-runs.
  }, [billId, nonce]);

  return { bill, deltas, errors, cached, incomplete, incompleteReason, loading, refreshing, recompute };
}
