import type { BillAmendmentOp, ProvisionDelta } from "../../types";
import { ProvisionDiff } from "./ProvisionDiff";

// One amendment, shown full-height in the pager. The card's title IS the bill's
// instruction (what the bill says); the diff below shows where it lands in the
// Act. Approving doesn't collapse anything — it recolours the border and advances
// to the next amendment (see DeltaReview).
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
  const warn = !op.anchorFound;

  return (
    <div className={`dr-card is-${op.op}${approved ? " is-approved" : ""}${warn ? " is-warn" : ""}`}>
      <div className="dr-card-head">
        <p className="dr-card-instruction">{op.instruction || op.note || "(no instruction text)"}</p>
        <div className="dr-card-meta">
          {warn && (
            <span className="dr-card-warn" title="Location not verified against the Act — check the PDF">
              ⚠ unverified
            </span>
          )}
          {approved && <span className="dr-card-approved">✓ approved</span>}
        </div>
      </div>

      {op.newText && <p className="dr-says-new">{op.newText}</p>}

      <section className="dr-lands">
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
