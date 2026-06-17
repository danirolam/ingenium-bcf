import type { Bill } from "../../types";

// The official bill PDF (proxied via /api/bills/:id/pdf so parl.ca can be
// embedded), shown alongside the cards as the authoritative cross-check. A small
// toolbar sits at the top of the pane so counsel can collapse it, step it wider
// or narrower, or expand it, while it stays in its left position.
export function BillPdfPane({
  bill,
  onCollapse,
  onNarrower,
  onWider,
  onExpand,
}: {
  bill: Bill | null;
  onCollapse: () => void;
  onNarrower: () => void;
  onWider: () => void;
  onExpand: () => void;
}) {
  if (!bill) return null;
  return (
    <aside className="dr-pdf">
      <div className="dr-pdf-tools">
        <span className="dr-pdf-tools-name">Bill PDF</span>
        <div className="dr-pdf-tools-grp">
          <button type="button" className="dr-pdf-tool" onClick={onCollapse} title="Collapse the bill PDF">
            Collapse
          </button>
          <button type="button" className="dr-pdf-tool" onClick={onNarrower} title="Make it narrower" aria-label="Narrower">
            −
          </button>
          <button type="button" className="dr-pdf-tool" onClick={onWider} title="Make it wider" aria-label="Wider">
            +
          </button>
          <button type="button" className="dr-pdf-tool" onClick={onExpand} title="Expand the bill PDF">
            Expand
          </button>
        </div>
      </div>
      <iframe
        className="dr-pdf-frame"
        src={`/api/bills/${bill.id}/pdf`}
        title={`${bill.billNumber} official PDF`}
      />
    </aside>
  );
}
