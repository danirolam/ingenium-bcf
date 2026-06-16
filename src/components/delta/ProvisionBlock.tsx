import type { ActProvision, ProvisionDiffRow } from "../../types";
import { leafLabel, provDepthOf } from "./provisionShape";

// A single provision as one full-width line: its own leaf label ("(c)", "(1)",
// "5.3") indented by its depth in the Act hierarchy. Used for the ancestor
// breadcrumb pinned above the split diff (the section / subsection a change
// nests under), so the hierarchy stays visible while scrolling local context.
const SIGN: Record<ProvisionDiffRow["status"], string> = {
  added: "+",
  changed: "~",
  repealed: "−",
  unchanged: "",
};

// Depth used to indent a row (0 = top-level section).
export const provDepth = (row: ProvisionDiffRow): number => {
  const prov = row.after ?? row.before;
  return prov ? provDepthOf(prov) : 0;
};

export function ProvisionBlock({
  row,
  focus = false,
  baseDepth = 0,
}: {
  row: ProvisionDiffRow;
  focus?: boolean;
  /** Depth to treat as the left margin, so a window of deep siblings doesn't all
   *  float at a large indent — they nest relative to the shallowest row shown. */
  baseDepth?: number;
}) {
  const prov: ActProvision | undefined = row.after ?? row.before;
  if (!prov) return null;
  const indent = Math.max(0, provDepth(row) - baseDepth);

  return (
    <div className={`dr-prov is-${row.status}${focus ? " is-focus" : ""}`} style={{ paddingLeft: indent * 22 }}>
      <span className="dr-prov-sign" aria-hidden="true">
        {SIGN[row.status]}
      </span>
      <span className="dr-prov-label">{leafLabel(prov)}</span>
      <span className="dr-prov-main">
        {prov.marginalNote && <span className="dr-prov-mn">{prov.marginalNote}</span>}
        <span className="dr-prov-text">{prov.text}</span>
      </span>
    </div>
  );
}
