import type { Bill } from "../../types";

// The official bill PDF (proxied via /api/bills/:id/pdf so parl.ca can be
// embedded), shown alongside the cards as the authoritative cross-check.
export function BillPdfPane({ bill }: { bill: Bill | null }) {
  if (!bill) return null;
  return (
    <aside className="dr-pdf">
      <div className="dr-pdf-bar">
        <span className="dr-pdf-title">
          <span className="tnum">{bill.billNumber}</span> — official text
        </span>
        {bill.sourceUrl && (
          <a className="dr-pdf-link" href={bill.sourceUrl} target="_blank" rel="noreferrer">
            parl.ca ↗
          </a>
        )}
      </div>
      <iframe
        className="dr-pdf-frame"
        src={`/api/bills/${bill.id}/pdf`}
        title={`${bill.billNumber} official PDF`}
      />
    </aside>
  );
}
