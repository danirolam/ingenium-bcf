import { useEffect, useRef, useState } from "react";
import type { Nav } from "../App";
import { MomentumBadge } from "../components/badges";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Bill } from "../types";

export function BillMonitor({ nav }: { nav: Nav }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.bills.list().then(setBills).catch(console.error);
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { bill, email } = await api.bills.upload(raw);
      setBills((b) => [bill, ...b.filter((x) => x.id !== bill.id)]);
      nav.toast(
        email.simulated ? "Bill uploaded · Email simulated." : "Bill uploaded · Email sent.",
      );
    } catch (err: any) {
      nav.toast(`Upload failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openDelta(bill: Bill) {
    setBusy(true);
    try {
      const lv = await api.bills.extractDelta(bill.id);
      nav.go("delta", { lawVersionId: lv.id });
    } catch (err: any) {
      nav.toast(`Could not open delta: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Bill Monitor"]}
        title="Bill Monitor"
        sub="Federal and provincial legislation tracked here. Upload a bill JSON to ingest, normalize, and queue it for legal-delta review."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onUpload}
              style={{ display: "none" }}
            />
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? "Working…" : "+ Upload bill JSON"}
            </button>
          </>
        }
      />
      <div className="body">
        {bills.length === 0 ? (
          <div className="rd-empty">
            No bills yet. Upload a bill JSON to begin — try the Bill C-27 sample to walk through the demo.
          </div>
        ) : (
          <div className="card">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Bill</th>
                    <th>Title</th>
                    <th style={{ width: 160 }}>Status</th>
                    <th style={{ width: 140 }}>Momentum</th>
                    <th style={{ width: 220 }}>Latest movement</th>
                    <th style={{ width: 130 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="billno">{b.billNumber}</div>
                      </td>
                      <td>
                        <div className="billtitle">{b.title}</div>
                        {b.session && (
                          <div className="meta">Session {b.session}</div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: 13 }}>{b.status}</div>
                      </td>
                      <td>
                        <MomentumBadge value={b.legislativeMomentum} />
                      </td>
                      <td>
                        <div className="meta">
                          {b.latestActivity ?? "—"}
                        </div>
                        <div className="meta" style={{ marginTop: 2 }}>
                          {new Date(b.uploadedAt).toLocaleString()}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn sm"
                          disabled={busy}
                          onClick={() => openDelta(b)}
                        >
                          Open Delta →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
