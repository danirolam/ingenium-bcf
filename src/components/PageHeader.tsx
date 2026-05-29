import type { ReactNode } from "react";
import { InfoHint } from "./InfoHint";

export function PageHeader({
  title,
  sub,
  actions,
  hint,
}: {
  /** kept for backward compat; intentionally unused */
  crumbs?: string[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** Optional ⓘ next to the title explaining what this stage is for. */
  hint?: { title?: string; body: ReactNode };
}) {
  return (
    <header className="ph">
      <div className="ph-row">
        <div className="ph-main">
          <h1 className="ph-title">
            {title}
            {hint && <InfoHint title={hint.title} body={hint.body} />}
          </h1>
          {sub && <div className="ph-sub">{sub}</div>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
    </header>
  );
}
