import type { ActProvision, ProvisionDiffRow } from "../../types";

// The single law-rendering primitive: one provision as a diff row. Shows only the
// provision's OWN label segment ("(c)", "(1)", "5.3" — the leaf), indented by its
// depth in the Act hierarchy so the tree structure reads visually. Status drives a
// single coloured sign; produced rows (focus) sit at full opacity while the
// surrounding context is dimmed — no background fills.
const SIGN: Record<ProvisionDiffRow["status"], string> = {
  added: "+",
  changed: "~",
  repealed: "−",
  unchanged: "",
};

type Step = { kind: string; label: string };

// The provision's hierarchy steps. Prefer the server-supplied `path`; if it's
// missing (e.g. an AI-interpreted provision), derive it from the composed label
// so leaf labels + indentation still work.
function segments(prov: ActProvision): Step[] {
  if (prov.path && prov.path.length) return prov.path;
  const label = prov.label ?? "";
  if (/^[“"']/.test(label)) return [{ kind: "definition", label }];
  const sec = label.match(/^([0-9]+(?:\.[0-9]+)*[A-Za-z]?)/);
  const out: Step[] = [];
  let rest = label;
  if (sec) { out.push({ kind: "section", label: sec[1] }); rest = label.slice(sec[1].length); }
  for (const g of rest.match(/\([^)]+\)/g) ?? []) out.push({ kind: "sub", label: g.replace(/[()]/g, "") });
  return out.length ? out : [{ kind: "section", label }];
}

// Depth used to indent a row (0 = top-level section).
export const provDepth = (row: ProvisionDiffRow): number => {
  const prov = row.after ?? row.before;
  return prov ? Math.max(0, segments(prov).length - 1) : 0;
};

// The leaf label as it appears in the Act: sections keep their number ("5.3"),
// definitions their quoted term, everything else is bracketed ("(c)").
function leafLabel(prov: ActProvision): string {
  const segs = segments(prov);
  const last = segs[segs.length - 1];
  if (!last) return prov.label;
  return last.kind === "section" || last.kind === "definition" ? last.label : `(${last.label})`;
}

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
