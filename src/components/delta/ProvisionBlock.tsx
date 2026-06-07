import type { ActProvision, ProvisionDiffRow } from "../../types";

// The single law-rendering primitive: one provision as a diff row. Shows only the
// provision's OWN label segment ("(c)", "(1)", "5.3" — the leaf), indented by its
// depth in the Act hierarchy so the tree structure reads visually. Status shows as
// a single coloured sign; produced rows (focus) sit at full opacity while the
// surrounding context is dimmed — no background fills.
const SIGN: Record<ProvisionDiffRow["status"], string> = {
  added: "+",
  changed: "~",
  repealed: "−",
  unchanged: "",
};

// The leaf label as it appears in the Act: sections keep their number ("5.3"),
// definitions their quoted term, everything else is bracketed ("(c)").
function leafLabel(prov: ActProvision): string {
  const last = prov.path?.[prov.path.length - 1];
  if (!last) return prov.label;
  if (last.kind === "section" || last.kind === "definition") return last.label;
  return `(${last.label})`;
}

export const provDepth = (row: ProvisionDiffRow): number =>
  Math.max(0, ((row.after ?? row.before)?.path?.length ?? 1) - 1);

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
    <div
      className={`dr-prov is-${row.status}${focus ? " is-focus" : ""}`}
      style={{ paddingLeft: indent * 22 }}
    >
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
