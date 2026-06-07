import type { BillAmendmentOp, ProvisionDelta } from "../../types";
import { ProvisionDiff } from "./ProvisionDiff";

const OP_LABEL: Record<BillAmendmentOp["op"], string> = {
  add: "Add",
  replace: "Replace",
  repeal: "Repeal",
  amend: "Amend",
};

// One amendment = one card. Collapsed: op badge, anchor (+ warning if the anchor
// wasn't verified), provenance tag, approval state. Expanded: what the bill says
// and where it lands in the Act. Purely presentational — all data is pre-resolved
// on `op`; approve/collapse is driven by the parent.
export function AmendmentCard({
  delta,
  op,
  approved,
  open,
  onToggle,
  onApprove,
}: {
  delta: ProvisionDelta;
  op: BillAmendmentOp;
  approved: boolean;
  open: boolean;
  onToggle: () => void;
  onApprove: (approved: boolean) => void;
}) {
  const structured = delta.source === "bill-xml";
  const warn = !op.anchorFound;

  return (
    <div
      className={`dr-card is-${op.op}${approved ? " is-approved" : ""}${open ? " is-open" : ""}${
        warn ? " is-warn" : ""
      }`}
    >
      <button className="dr-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="dr-card-state" aria-hidden="true">
          {approved ? "✓" : <span className="dr-caret">{open ? "▾" : "▸"}</span>}
        </span>
        <span className={`dr-op is-${op.op}`}>{OP_LABEL[op.op]}</span>
        <span className="dr-card-anchor">
          {op.position ? `${op.position} ` : ""}
          {op.anchor ?? "(new section)"}
          {warn && (
            <span className="dr-card-warn" title="Anchor not verified against the Act">
              ⚠
            </span>
          )}
        </span>
        <span className="dr-card-meta">
          {op.count ? <span className="dr-card-count">{op.count} prov.</span> : null}
          <span className={`dr-tag is-${structured ? "structured" : "ai"}`}>
            {structured ? "structured" : "ai-located"}
          </span>
        </span>
      </button>

      {open && (
        <div className="dr-card-body">
          <section className="dr-says">
            <div className="dr-says-h">Bill says</div>
            <p className="dr-says-text">{op.instruction || op.note || "(no instruction text)"}</p>
            {op.newText && <p className="dr-says-new">{op.newText}</p>}
          </section>

          <section className="dr-lands">
            <div className="dr-lands-h">In the {delta.title}</div>
            <ProvisionDiff delta={delta} op={op} />
          </section>

          <div className="dr-card-actions">
            {approved ? (
              <button className="btn ghost sm" onClick={() => onApprove(false)}>
                Undo approval
              </button>
            ) : (
              <button className="btn primary" onClick={() => onApprove(true)}>
                Approve placement
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
