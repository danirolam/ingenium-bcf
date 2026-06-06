import { useEffect, useState } from "react";
import type { Nav } from "../App";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Bill, ProvisionDelta } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// The amendment-review UI was cleared for a rebuild. This shell does the data
// side only: resolve a bill, load its grounded provision-delta, and expose it.
// The rendering UI is to be rebuilt where marked below.
// ─────────────────────────────────────────────────────────────────────────────
export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [deltas, setDeltas] = useState<ProvisionDelta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickList, setPickList] = useState<Bill[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    api.bills.list(signal).then(setPickList).catch(() => {});

    (async () => {
      let billId: string | null = nav.params.billId ?? null;
      if (!billId) {
        const bills = await api.bills.list(signal);
        billId =
          (bills.find((b) => b.billNumber === "C-265") ??
            bills.find((b) => /\bamend/i.test(b.title)))?.id ?? null;
      }
      if (!billId) {
        if (!signal.aborted) setDeltas([]);
        return;
      }
      setLoading(true);
      const b = await api.bills.get(billId, signal).catch(() => null);
      if (signal.aborted) return;
      setBill(b);
      const res = await api.bills
        .provisionDelta(billId, false, signal)
        .catch(() => ({ deltas: [] as ProvisionDelta[] }));
      if (signal.aborted) return;
      setDeltas(res.deltas ?? []);
      setLoading(false);
    })().catch((err) => {
      if (err?.name === "AbortError") return;
      console.error(err);
      setLoading(false);
    });

    return () => ac.abort();
  }, [nav.params.billId]);

  // No bill chosen → let the user pick one.
  if (!nav.params.billId && deltas !== null && deltas.length === 0 && !bill && !loading) {
    const candidates = pickList.filter((b) => /\bamend/i.test(b.title)).slice(0, 24);
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Legal delta"]}
          title="Legal delta"
          sub="Choose a bill to review the changes it makes to existing law."
        />
        <div className="body">
          <div className="card" style={{ padding: "22px 24px" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700 }}>Pick a bill to review</h3>
            {candidates.length === 0 ? (
              <div className="rd-empty">Loading bills…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 10 }}>
                {candidates.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => nav.go("delta", { billId: b.id })}
                    style={{
                      textAlign: "left", padding: "12px 14px", borderRadius: 10,
                      border: "1px solid var(--border)", background: "var(--panel)", cursor: "pointer",
                      display: "flex", flexDirection: "column", gap: 7,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="tnum" style={{ color: "var(--accent-warm)", fontWeight: 600, fontFamily: "var(--mono)" }}>
                        {b.billNumber}
                      </span>
                      <MomentumBadge value={b.legislativeMomentum} />
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{b.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  if (loading || deltas === null) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
          title={`Legal delta — ${bill?.billNumber ?? ""}`}
          sub={bill?.title}
        />
        <div className="body">
          <div className="card" style={{ padding: "22px 24px" }}>
            <div className="rd-empty">Interpreting the bill against the Act…</div>
          </div>
        </div>
      </>
    );
  }

  const amendments = deltas.reduce((n, d) => n + (d.operations?.length ?? 0), 0);

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
        title={`Legal delta — ${bill?.billNumber ?? ""}`}
        sub={bill?.title}
      />
      <div className="body">
        {/* ───── Amendment UI to be rebuilt here. `deltas` holds the grounded
            provision-delta (affected Acts, operations, before/after rows). ───── */}
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          {deltas.length > 0 ? (
            <div className="rd-empty">
              Loaded {deltas.length} affected Act{deltas.length === 1 ? "" : "s"} · {amendments} amendment
              {amendments === 1 ? "" : "s"}. Amendment UI to be rebuilt.
            </div>
          ) : (
            <div className="rd-empty">
              No grounded delta for {bill?.billNumber ?? "this bill"} — it creates a new Act, amends one we
              don’t track, or has no ingested text.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
