import type { BillAmendmentOp, ProvisionDelta } from "../../types";
import { ProvisionDiff } from "./ProvisionDiff";

const OP_LABEL: Record<BillAmendmentOp["op"], string> = {
  add: "Add",
  replace: "Replace",
  repeal: "Repeal",
  amend: "Amend",
};

// One amendment, shown full-height in the pager. Always expanded — approving
// doesn't collapse it, it recolours the border (see .dr-card.is-approved). The
// "In the Act" diff fills the remaining height and scrolls within.
export function AmendmentCard({
  delta,
  op,
  approved,
  onApprove,
}: {
  delta: ProvisionDelta;
  op: BillAmendmentOp;
  approved: boolean;
  onApprove: (approved: boolean) => void;
}) {
  // Per-op provenance: structural (deterministic from the bill XML) vs ai-located
  // (the AI scalpel/interpreter). Falls back to the delta-level source.
  const structured = op.resolution ? op.resolution === "structured" : delta.source === "bill-xml";
  const warn = !op.anchorFound;

  return (
    <div className={`dr-card is-${op.op}${approved ? " is-approved" : ""}${warn ? " is-warn" : ""}`}>
      <div className="dr-card-head">
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
          {approved && <span className="dr-card-approved">✓ approved</span>}
        </span>
      </div>

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
        <button
          className={approved ? "btn ghost sm" : "btn primary"}
          onClick={() => onApprove(!approved)}
        >
          {approved ? "Approved — click to undo" : "Approve placement"}
        </button>
      </div>
    </div>
  );
}
