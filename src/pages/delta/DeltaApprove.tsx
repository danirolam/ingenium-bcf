import { useMemo, useState } from "react";
import type { Bill, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../../types";
import { ProvBlock } from "../../components/ProvisionDeltaView";

function actName(t: string): string {
  return t.replace(/\s*\([^)]*\)\s*$/, "");
}
const keyOf = (slug: string, i: number) => `${slug}#${i}`;
const norm = (s?: string | null) => (s ?? "").replace(/\s+/g, "").toLowerCase();

const VARIANT: Record<string, "added" | "changed" | "repealed" | "plain"> = {
  added: "added",
  changed: "changed",
  repealed: "repealed",
  unchanged: "plain",
};

type QueueItem = {
  title: string;
  citation: string;
  op: BillAmendmentOp;
  key: string;
  delta: ProvisionDelta;
};

function buildQueue(deltas: ProvisionDelta[]): QueueItem[] {
  const out: QueueItem[] = [];
  for (const d of deltas) {
    (d.operations ?? []).forEach((op, i) =>
      out.push({ title: d.title, citation: d.citation, op, key: keyOf(d.slug, i), delta: d }),
    );
  }
  return out;
}

const sectionOf = (label?: string | null) =>
  norm(label).match(/^[0-9]+(?:\.[0-9]+)*[a-z]?/)?.[0] ?? "";
// Pull a provision reference out of an instruction note ("Paragraph 6(1)(e.1)
// of the Act is replaced…") when the op carries no parsed anchor.
const refFromNote = (note?: string | null) =>
  note?.match(/(?:sections?|subsections?|paragraphs?|subparagraphs?|clauses?)\s+([0-9A-Za-z.]+(?:\([^)]+\))*)/i)?.[1] ?? "";

// The changed provision(s) for this amendment, plus a little context either
// side. Inserted rows carry a LEAF label ("(e.1)") while the bill anchor is the
// full chain ("6(1)(e.1)"), so after an exact try we match by suffix; failing
// that we centre on the change's section so surrounding provisions still show.
function focusWindow(
  delta: ProvisionDelta,
  op: BillAmendmentOp,
  ctx = 5,
): { rows: ProvisionDiffRow[]; focusIdx: number } {
  const rows = delta.rows ?? [];
  if (rows.length === 0) return { rows: [], focusIdx: -1 };
  const a = norm(op.anchor);
  const labelsOf = (r: ProvisionDiffRow) =>
    [r.label, r.after?.label, r.before?.label].map(norm).filter(Boolean);

  let idx = -1;
  // 1) exact anchor on a changed row
  if (a) idx = rows.findIndex((r) => r.status !== "unchanged" && labelsOf(r).includes(a));
  // 2) deep anchor → the leaf-labelled changed row (longest suffix of the anchor)
  if (idx < 0 && a.length >= 3) {
    let bestLen = 0;
    rows.forEach((r, i) => {
      if (r.status === "unchanged") return;
      for (const rl of labelsOf(r)) {
        if (rl.length >= 3 && rl.length > bestLen && a.endsWith(rl)) {
          idx = i;
          bestLen = rl.length;
        }
      }
    });
  }
  // 3) exact anchor on any (unchanged) row — the Act's existing provision
  if (idx < 0 && a) idx = rows.findIndex((r) => labelsOf(r).includes(a));
  // 4) by section (from the anchor or the note) — centre on a change there
  if (idx < 0) {
    const sec = sectionOf(op.anchor) || sectionOf(refFromNote(op.note));
    if (sec) {
      const inSec = (r: ProvisionDiffRow) => sectionOf((r.after ?? r.before)?.label) === sec;
      idx = rows.findIndex((r) => r.status !== "unchanged" && inSec(r));
      if (idx < 0) idx = rows.findIndex(inSec);
    }
  }
  // 5) last resort — the first change anywhere; still windowed so context shows
  if (idx < 0) idx = rows.findIndex((r) => r.status !== "unchanged");
  if (idx < 0) idx = 0;

  const start = Math.max(0, idx - ctx);
  const end = Math.min(rows.length, idx + ctx + 1);
  return { rows: rows.slice(start, end), focusIdx: idx - start };
}

// Phase 2 — the official bill PDF stays on the left for cross-referencing while
// the right is a list of clause↔insertion cards: bill extract on top, the
// resulting Act provision(s) below. Approving a card collapses it; once every
// card is approved you export the amended Act.
export function DeltaApprove({
  bill,
  deltas,
  approved,
  onSet,
  onExport,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  approved: Set<string>;
  onSet: (keys: string[], value: boolean) => void;
  onExport: () => void;
}) {
  const queue = useMemo(() => buildQueue(deltas), [deltas]);
  // Per-card expand override; default is "expanded until approved".
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const total = queue.length;
  const doneCount = queue.filter((q) => approved.has(q.key)).length;
  const allDone = total > 0 && doneCount >= total;

  const isOpen = (key: string) => override[key] ?? !approved.has(key);
  const approve = (key: string) => {
    onSet([key], true);
    setOverride((o) => ({ ...o, [key]: false })); // auto-collapse
  };
  const undo = (key: string) => {
    onSet([key], false);
    setOverride((o) => ({ ...o, [key]: true }));
  };
  const toggle = (key: string) => setOverride((o) => ({ ...o, [key]: !isOpen(key) }));
  const approveAll = () => {
    onSet(queue.map((q) => q.key), true);
    setOverride(Object.fromEntries(queue.map((q) => [q.key, false])));
  };

  return (
    <div className="dap2">
      <aside className="dap2-pdf dv-pane">
        <div className="dv-pane-head">
          <span>{bill?.billNumber ?? "Bill"} — official bill</span>
          {bill?.sourceUrl && (
            <a href={bill.sourceUrl} target="_blank" rel="noreferrer" className="dv-ext">
              parl.ca ↗
            </a>
          )}
        </div>
        {bill ? (
          <iframe className="dv-pdf-frame" src={`/api/bills/${bill.id}/pdf`} title={`${bill.billNumber} PDF`} />
        ) : (
          <div className="rd-empty">No bill loaded.</div>
        )}
      </aside>

      <section className="dap2-list">
        <div className="dap2-bar">
          <span>
            <b>{doneCount}</b> / {total} placement{total === 1 ? "" : "s"} approved
          </span>
          <div className="dap2-bar-actions">
            {!allDone && (
              <button className="btn ghost sm" onClick={approveAll}>
                Approve all
              </button>
            )}
            <button
              className="btn primary sm"
              disabled={!allDone}
              onClick={onExport}
              title={allDone ? "Export the amended Act as PDF" : "Approve every placement first"}
            >
              Export →
            </button>
          </div>
        </div>

        <div className="dap2-cards">
          {queue.length === 0 && <div className="rd-empty">No amendments to approve.</div>}
          {queue.map((q) => {
            const open = isOpen(q.key);
            const appr = approved.has(q.key);
            const win = open ? focusWindow(q.delta, q.op) : null;
            return (
              <div className={`dap2-card${appr ? " is-approved" : ""}${open ? " is-open" : ""}`} key={q.key}>
                <button className="dap2-card-head" onClick={() => toggle(q.key)}>
                  <span className="dap2-check">{appr ? "✓" : ""}</span>
                  <span className={`pd-amend-op op-${q.op.op}`}>{q.op.op}</span>
                  <span className="dap2-anchor">
                    {q.op.anchor ?? "new part"}
                    {!q.op.anchorFound && <span className="dap2-warn"> ⚠</span>}
                  </span>
                  <span className="dap2-act">{actName(q.title)}</span>
                  <span
                    className={`dap2-method${q.delta.source === "ai" ? " is-ai" : ""}`}
                    title={
                      q.delta.source === "ai"
                        ? "Location resolved by AI"
                        : "Location matched against the Act's structure"
                    }
                  >
                    {q.delta.source === "ai" ? "ai-located" : "structured"}
                  </span>
                  <span className="dap2-caret">{open ? "▾" : "▸"}</span>
                </button>

                {open && win && (
                  <div className="dap2-card-body">
                    <div className="dap2-block dap2-said">
                      <div className="dap2-sec-h">Bill says</div>
                      {q.op.note && <p className="dap2-instr">{q.op.note}</p>}
                      {q.op.newText && <div className="dap2-inserted">{q.op.newText}</div>}
                      {!q.op.note && !q.op.newText && (
                        <p className="dap2-instr dap2-muted">
                          {q.op.op} {q.op.anchor ?? ""}
                        </p>
                      )}
                    </div>

                    <div className="dap2-block dap2-result">
                      <div className="dap2-sec-h">In the {actName(q.title)}</div>
                      <div className="dap-diff">
                        {win.rows.length === 0 ? (
                          <div className="rd-empty">No matching provision found.</div>
                        ) : (
                          win.rows.map((r, i) => (
                            <div key={i} className={i === win.focusIdx ? "dap-diff-focus" : undefined}>
                              <ProvBlock prov={(r.after ?? r.before)!} variant={VARIANT[r.status] ?? "plain"} />
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="dap2-card-foot">
                      {appr ? (
                        <button className="btn sm" onClick={() => undo(q.key)}>
                          ✓ Approved — undo
                        </button>
                      ) : (
                        <button className="btn primary" onClick={() => approve(q.key)}>
                          Approve placement ✓
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
