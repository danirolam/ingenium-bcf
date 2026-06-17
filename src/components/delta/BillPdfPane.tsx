import type { Bill } from "../../types";

// The official bill PDF (proxied via /api/bills/:id/pdf so parl.ca can be
// embedded), shown alongside the cards as the authoritative cross-check. Its
// own title bar is gone — the bill identity + parl.ca link live in the workspace
// top bar (one merged header), so the iframe fills the whole pane.
export function BillPdfPane({ bill }: { bill: Bill | null }) {
  if (!bill) return null;
  return (
    <aside className="dr-pdf">
      <iframe
        className="dr-pdf-frame"
        src={`/api/bills/${bill.id}/pdf`}
        title={`${bill.billNumber} official PDF`}
      />
    </aside>
  );
}
