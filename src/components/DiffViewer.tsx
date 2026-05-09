import { diffWordsWithSpace } from "diff";
import { Fragment, useMemo } from "react";

type InlinePart = { op: "eq" | "add" | "del"; t: string };

type Block =
  | { kind: "header"; heading: string; sub?: string }
  | { kind: "unchanged"; label: string; text: string }
  | { kind: "changed"; label: string; old: InlinePart[]; new: InlinePart[] }
  | { kind: "added"; label: string; text: string }
  | { kind: "removed"; label: string; text: string }
  | { kind: "identical-collapse"; count: number };

function splitParas(text: string): { label: string; body: string }[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para, i) => {
      const m = para.match(/^(Section\s+\d+[^.]*\.|s\.\s*\d+(?:\([^)]+\))?|\([\d\w]+\))\s*(.*)$/s);
      const label = m ? m[1] : `¶ ${i + 1}`;
      const body = m ? (m[2] || para) : para;
      return { label, body };
    });
}

function inlineParts(oldText: string, newText: string): {
  oldParts: InlinePart[];
  newParts: InlinePart[];
} {
  const parts = diffWordsWithSpace(oldText, newText);
  const oldParts: InlinePart[] = [];
  const newParts: InlinePart[] = [];
  for (const p of parts) {
    if (p.added) newParts.push({ op: "add", t: p.value });
    else if (p.removed) oldParts.push({ op: "del", t: p.value });
    else {
      oldParts.push({ op: "eq", t: p.value });
      newParts.push({ op: "eq", t: p.value });
    }
  }
  return { oldParts, newParts };
}

export function buildDiffBlocks(oldText: string, newText: string): Block[] {
  const left = splitParas(oldText);
  const right = splitParas(newText);
  const blocks: Block[] = [];
  const len = Math.max(left.length, right.length);
  let identicalRun = 0;

  const flush = () => {
    if (identicalRun > 0) {
      blocks.push({ kind: "identical-collapse", count: identicalRun });
      identicalRun = 0;
    }
  };

  for (let i = 0; i < len; i++) {
    const L = left[i];
    const R = right[i];
    if (L && R && L.body === R.body) {
      identicalRun++;
      continue;
    }
    flush();
    if (L && R) {
      const { oldParts, newParts } = inlineParts(L.body, R.body);
      blocks.push({
        kind: "changed",
        label: R.label || L.label,
        old: oldParts,
        new: newParts,
      });
    } else if (R) {
      blocks.push({ kind: "added", label: R.label, text: R.body });
    } else if (L) {
      blocks.push({ kind: "removed", label: L.label, text: L.body });
    }
  }
  flush();
  return blocks;
}

function renderInline(parts: InlinePart[]) {
  return parts.map((p, i) => {
    if (p.op === "del") return <span className="del" key={i}>{p.t}</span>;
    if (p.op === "add") return <span className="add" key={i}>{p.t}</span>;
    return <span key={i}>{p.t}</span>;
  });
}

export function DiffViewer({
  actName,
  actCitation,
  oldText,
  newText,
  versionALabel,
  versionBLabel,
}: {
  actName: string;
  actCitation: string;
  oldText: string;
  newText: string;
  versionALabel: string;
  versionBLabel: string;
}) {
  const blocks = useMemo(() => buildDiffBlocks(oldText, newText), [oldText, newText]);
  const materialChanges = blocks.filter(
    (b) => b.kind === "changed" || b.kind === "added" || b.kind === "removed",
  ).length;

  const renderSide = (b: Block, side: "L" | "R") => {
    if (b.kind === "unchanged") {
      return (
        <div className="diff-block">
          <div className="lbl">{b.label}</div>
          <div className="txt">{b.text}</div>
        </div>
      );
    }
    if (b.kind === "changed") {
      return (
        <div className="diff-block changed">
          <div className="lbl">{b.label}</div>
          <div className="txt">{renderInline(side === "L" ? b.old : b.new)}</div>
        </div>
      );
    }
    if (b.kind === "added") {
      if (side === "L") return <div className="diff-block" style={{ minHeight: 60 }} />;
      return (
        <div className="diff-block added">
          <div className="lbl">{b.label}</div>
          <div className="txt">{b.text}</div>
        </div>
      );
    }
    if (b.kind === "removed") {
      if (side === "R") return <div className="diff-block" style={{ minHeight: 60 }} />;
      return (
        <div className="diff-block removed">
          <div className="lbl">{b.label}</div>
          <div className="txt">{b.text}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="diff-shell">
      <div className="diff-topbar">
        <div className="diff-crumbs">
          <span>CanLII-style comparator</span>
          <span className="sep">/</span>
          <b>{actName}</b>
          <span className="sep">/</span>
          <span>{actCitation}</span>
        </div>
        <div className="diff-pager">
          <span className="change-pill">
            {materialChanges} material change{materialChanges === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="diff-versions">
        <div className="diff-version">
          <div className="vlabel">From</div>
          <select defaultValue={versionALabel}>
            <option>{versionALabel}</option>
          </select>
        </div>
        <div className="diff-version">
          <div className="vlabel">To</div>
          <select defaultValue={versionBLabel}>
            <option>{versionBLabel}</option>
          </select>
        </div>
      </div>

      <div className="diff-body">
        <div className="diff-col">
          <div className="diff-act-head">{actName.toUpperCase()}</div>
          <div className="diff-act-cite">{actCitation}</div>
        </div>
        <div className="diff-col">
          <div className="diff-act-head">{actName.toUpperCase()}</div>
          <div className="diff-act-cite">
            {actCitation} <span style={{ color: "var(--accent)" }}>(as proposed)</span>
          </div>
        </div>

        {blocks.map((b, i) => {
          if (b.kind === "header") {
            return (
              <div className="diff-header-row" key={i}>
                <h3>{b.heading}</h3>
                {b.sub && <div className="sub">{b.sub}</div>}
              </div>
            );
          }
          if (b.kind === "identical-collapse") {
            return (
              <div className="diff-collapse" key={i}>
                {b.count} identical paragraph{b.count === 1 ? "" : "s"}
              </div>
            );
          }
          return (
            <Fragment key={i}>
              <div>{renderSide(b, "L")}</div>
              <div>{renderSide(b, "R")}</div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
