import type { ActProvision, ProvisionDiffRow } from "../../types";
import { leafLabel, provDepthOf } from "./provisionShape";
import { wordDiff, type WordPart } from "../../lib/wordDiff";

// One diff row rendered GitHub-split / CanLII style: the current text on the
// left, the amended text on the right. A changed provision is refined to the
// word level — only the words that differ are tinted — while a wholly added or
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
  // A wholesale add/del (no word parts) tints the entire line; a changed cell
  // carries the soft line tint and lets the word spans do the strong highlight.
  const whole = (intent === "add" || intent === "del") && !parts;
  return (
    <div className={`dr-cell is-${intent}${whole ? " is-whole" : ""}`} style={{ paddingLeft: 10 + indent * 18 }}>
      <span className="dr-cell-sign" aria-hidden="true">
        {intent === "add" ? "+" : intent === "del" ? "−" : ""}
      </span>
      <span className="dr-cell-label">{leafLabel(prov)}</span>
      <span className="dr-cell-main">
        {prov.marginalNote && <span className="dr-cell-mn">{prov.marginalNote}</span>}
        <span className="dr-cell-text">{parts ? <Words parts={parts} /> : prov.text}</span>
      </span>
    </div>
  );
}

export function SplitRow({
  row,
  focus = false,
  baseDepth = 0,
}: {
  row: ProvisionDiffRow;
  /** True when this row is one the current amendment produced (vs. surrounding
   *  context or a neighbouring change). */
  focus?: boolean;
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
      const wd = wordDiff(row.before?.text ?? "", row.after?.text ?? "");
      leftParts = wd.left;
      rightParts = wd.right;
      break;
    }
    default:
      leftIntent = "context";
      rightIntent = "context";
  }

  return (
    <div className={`dr-srow is-${row.status}${focus ? " is-focus" : ""}`}>
      <Cell prov={row.before} intent={leftIntent} parts={leftParts} baseDepth={baseDepth} />
      <Cell prov={row.after} intent={rightIntent} parts={rightParts} baseDepth={baseDepth} />
    </div>
  );
}
