import type { ReactNode } from "react";

export function PageHeader({
  crumbs = [],
  title,
  sub,
  actions,
}: {
  crumbs?: string[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ph">
      {crumbs.length > 0 && (
        <div className="ph-crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}
      <div className="ph-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="ph-title">{title}</h1>
          {sub && <div className="ph-sub">{sub}</div>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
    </header>
  );
}
