import type { ActProvision } from "../../types";

// One provision rendered as a GitHub-style diff row. Colour + left stripe carry
// add/remove/change; the label shows only its leaf segment, indented by depth.
// The single shared law-rendering primitive — used by every delta screen.
export function ProvisionBlock({
  prov,
  variant,
}: {
  prov: ActProvision;
  variant: "added" | "repealed" | "changed" | "plain";
}) {
  const depth = Math.max(0, (prov.path?.length ?? 1) - 1);
  const leaf = prov.label.match(/\([^)]*\)$/)?.[0] ?? prov.label;
  return (
    <div className={`lawdiff-row v-${variant}`} style={{ paddingLeft: 16 + depth * 22 }} title={prov.label}>
      {prov.marginalNote && <div className="lawdiff-mn">{prov.marginalNote}</div>}
      <div className="lawdiff-text">
        <span className="lawdiff-label">{leaf}</span> {prov.text}
      </div>
    </div>
  );
}
