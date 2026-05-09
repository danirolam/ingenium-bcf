import type { ReactNode } from "react";

export function PageHeader({
  title,
  sub,
  actions,
}: {
  /** kept for backward compat; intentionally unused */
  crumbs?: string[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ph">
      <div className="ph-row">
        <div className="ph-main">
          <h1 className="ph-title">{title}</h1>
          {sub && <div className="ph-sub">{sub}</div>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
    </header>
  );
}
