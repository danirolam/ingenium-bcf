import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface ApprovalsState {
  /** The set of approved amendment keys ("<actSlug>#<opIndex>"). */
  approvedKeys: Set<string>;
  isApproved: (key: string) => boolean;
  /** Approve/unapprove one or many keys. Optimistic, then reconciled with the server. */
  setApproved: (keys: string[], approved: boolean) => void;
  /** Re-pull approvals from the server (e.g. after a recompute cleared them). */
  refetch: () => void;
  loading: boolean;
}

// Single source of truth for approval state. The server (FILES.approvals) is
// authoritative; the local Set is an optimistic mirror that every mutation
// reconciles against the server's returned canonical key list (and reverts on
// failure), so the two can't drift.
export function useApprovals(billId: string | null): ApprovalsState {
  const [approvedKeys, setApprovedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const billRef = useRef(billId);
  billRef.current = billId;

  useEffect(() => {
    if (!billId) { setApprovedKeys(new Set()); return; }
    const ac = new AbortController();
    setLoading(true);
    api.bills.approvals
      .get(billId, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setApprovedKeys(new Set(r.keys)); })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [billId]);

  const setApproved = useCallback((keys: string[], approved: boolean) => {
    const id = billRef.current;
    if (!id || keys.length === 0) return;

    const apply = (prev: Set<string>, add: boolean) => {
      const next = new Set(prev);
      for (const k of keys) add ? next.add(k) : next.delete(k);
      return next;
    };

    setApprovedKeys((prev) => apply(prev, approved)); // optimistic
    api.bills.approvals
      .set(id, { keys, approved })
      .then((r) => { if (billRef.current === id) setApprovedKeys(new Set(r.keys)); }) // reconcile
      .catch(() => { if (billRef.current === id) setApprovedKeys((prev) => apply(prev, !approved)); }); // revert
  }, []);

  const isApproved = useCallback((key: string) => approvedKeys.has(key), [approvedKeys]);

  // Re-pull from the server - used after a recompute, which clears approvals
  // server-side (new delta ⇒ new placements to approve).
  const refetch = useCallback(() => {
    const id = billRef.current;
    if (!id) { setApprovedKeys(new Set()); return; }
    api.bills.approvals
      .get(id)
      .then((r) => { if (billRef.current === id) setApprovedKeys(new Set(r.keys)); })
      .catch(() => {});
  }, []);

  return { approvedKeys, isApproved, setApproved, refetch, loading };
}
