import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Server-backed per-amendment approvals for a bill's delta. Keys are
// "<actSlug>#<opIndex>". Updates are optimistic and reverted on failure.
export function useApprovals(billId: string | null) {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!billId) {
      setApproved(new Set());
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    api.bills.approvals
      .get(billId, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setApproved(new Set(r.keys));
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [billId]);

  const set = useCallback(
    async (keys: string[], value: boolean) => {
      if (!billId || keys.length === 0) return;
      const apply = (s: Set<string>, on: boolean) => {
        const n = new Set(s);
        for (const k of keys) on ? n.add(k) : n.delete(k);
        return n;
      };
      setApproved((s) => apply(s, value)); // optimistic
      try {
        const r = await api.bills.approvals.set(billId, { keys, approved: value });
        setApproved(new Set(r.keys));
      } catch {
        setApproved((s) => apply(s, !value)); // revert
      }
    },
    [billId],
  );

  const toggle = useCallback(
    (key: string) => set([key], !approved.has(key)),
    [set, approved],
  );

  return { approved, loading, toggle, set };
}
