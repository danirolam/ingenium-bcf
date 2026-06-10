import type { ActProvision } from "../../types";

// Shared law-rendering primitives: how a provision maps to its hierarchy steps,
// its indentation depth, and its leaf label. One source of truth for the diff
// rows, the ancestor breadcrumb, and the PDF export — so labels + indentation
// never disagree between them.

export type Step = { kind: string; label: string };

// The provision's hierarchy steps. Prefer the server-supplied `path`; if it's
// missing (e.g. an AI-interpreted provision), derive it from the composed label
// so leaf labels + indentation still work.
export function segments(prov: ActProvision): Step[] {
  if (prov.path && prov.path.length) return prov.path;
  const label = prov.label ?? "";
  if (/^[“"']/.test(label)) return [{ kind: "definition", label }];
  const sec = label.match(/^([0-9]+(?:\.[0-9]+)*[A-Za-z]?)/);
  const out: Step[] = [];
  let rest = label;
  if (sec) {
    out.push({ kind: "section", label: sec[1] });
    rest = label.slice(sec[1].length);
  }
  for (const g of rest.match(/\([^)]+\)/g) ?? []) out.push({ kind: "sub", label: g.replace(/[()]/g, "") });
  return out.length ? out : [{ kind: "section", label }];
}

// Depth used to indent a provision (0 = top-level section).
export const provDepthOf = (prov: ActProvision): number => Math.max(0, segments(prov).length - 1);

// The leaf label as it appears in the Act: sections keep their number ("5.3"),
// definitions their quoted term, everything else is bracketed ("(c)").
export function leafLabel(prov: ActProvision): string {
  if (prov.kind === "schedule") return prov.label; // e.g. "SCHEDULE IV row 2222" (don't normalize)
  const segs = segments(prov);
  const last = segs[segs.length - 1];
  if (!last) return prov.label;
  return last.kind === "section" || last.kind === "definition" ? last.label : `(${last.label})`;
}
