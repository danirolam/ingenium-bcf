import type { ActProvision, ProvisionDiffRow } from "../../types";
import { displayText, leafLabel, provDepthOf } from "./provisionShape";
import { wordDiff, type WordPart } from "../../lib/wordDiff";

// One diff row rendered GitHub-split / CanLII style: the current text on the
// left, the amended text on the right. A changed provision is refined to the
// word level - only the words that differ are tinted - while a wholly added or
// repealed provision tints the whole line.

type Intent = "add" | "del" | "context" | "empty";

function Words({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "del" ? (
          <del key={i} className="dr-wd-del">{p.text}</del>
        ) : (
          <ins key={i} className="dr-wd-add">{p.text}</ins>
        ),
      )}
    </>
  );
}

function Cell({
  prov,
  intent,
  parts,
  baseDepth,
}: {
  prov?: ActProvision;
  intent: Intent;
  parts?: WordPart[];
  baseDepth: number;
}) {
  if (!prov || intent === "empty") return <div className="dr-cell is-empty" aria-hidden="true" />;
  const indent = Math.max(0, provDepthOf(prov) - baseDepth);
  // A Part/Division title: the text IS the heading - render it big with no label.
  // The row's add/del tint still applies, so a bill-added heading shows green.
  if (prov.kind === "heading") {
    return (
      <div className={`dr-cell dr-cell-heading is-${intent}`}>
        <span className="dr-cell-sign" aria-hidden="true">{intent === "add" ? "+" : intent === "del" ? "−" : ""}</span>
        <span className="dr-cell-heading-text">{prov.text}</span>
      </div>
    );
  }
  // A wholesale add/del (no word parts) tints the entire line; a changed cell
  // carries the soft line tint and lets the word spans do the strong highlight.
  const whole = (intent === "add" || intent === "del") && !parts;
  return (
    <div className={`dr-cell is-${intent}${whole ? " is-whole" : ""}`} style={{ paddingLeft: 10 + indent * 18 }}>
      <span className="dr-cell-sign" aria-hidden="true">
        {intent === "add" ? "+" : intent === "del" ? "−" : ""}
      </span>
      <span className="dr-cell-main">
        {prov.marginalNote && <span className="dr-cell-mn">{prov.marginalNote}</span>}
        <span className="dr-cell-text">
          <span className="dr-cell-label">{leafLabel(prov)}</span>{" "}
          {parts ? <Words parts={parts} /> : displayText(prov)}
        </span>
      </span>
    </div>
  );
}

export function SplitRow({
  row,
  rowIndex,
  focus = false,
  dim = false,
  baseDepth = 0,
}: {
  row: ProvisionDiffRow;
  /** This row's index into delta.rows - used by the diff to scroll to a specific
   *  row (e.g. the section header) on mount. */
  rowIndex?: number;
  /** True when this row is one the current amendment produced (vs. surrounding
   *  context or a neighbouring change). */
  focus?: boolean;
  /** True when this row is a CHANGE from a different amendment - dimmed so the
   *  scrutinised change stands out. */
  dim?: boolean;
  baseDepth?: number;
}) {
  let leftIntent: Intent;
  let rightIntent: Intent;
  let leftParts: WordPart[] | undefined;
  let rightParts: WordPart[] | undefined;

  switch (row.status) {
    case "added":
      leftIntent = "empty";
      rightIntent = "add";
      break;
    case "repealed":
      leftIntent = "del";
      rightIntent = "empty";
      break;
    case "changed": {
      leftIntent = "del";
      rightIntent = "add";
      const wd = wordDiff(row.before ? displayText(row.before) : "", row.after ? displayText(row.after) : "");
      leftParts = wd.left;
      rightParts = wd.right;
      break;
    }
    default:
      leftIntent = "context";
      rightIntent = "context";
  }

  return (
    <div
      className={`dr-srow is-${row.status}${focus ? " is-focus" : ""}${dim ? " is-dim" : ""}`}
      data-ri={rowIndex}
      title={dim ? "This change belongs to another amendment" : undefined}
    >
      <Cell prov={row.before} intent={leftIntent} parts={leftParts} baseDepth={baseDepth} />
      <Cell prov={row.after} intent={rightIntent} parts={rightParts} baseDepth={baseDepth} />
    </div>
  );
}
