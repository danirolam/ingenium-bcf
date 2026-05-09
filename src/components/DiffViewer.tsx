import { diffWordsWithSpace } from "diff";
import { Fragment, useMemo, useState } from "react";
import { GitCompareArrows, Info } from "lucide-react";

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

function renderInline(parts: InlinePart[], onExplain: () => void) {
  return parts.map((p, i) => {
    if (p.op === "del") {
      return (
        <button className="diff-token del" key={i} type="button" onClick={onExplain}>
          {p.t}
        </button>
      );
    }
    if (p.op === "add") {
      return (
        <button className="diff-token add" key={i} type="button" onClick={onExplain}>
          {p.t}
        </button>
      );
    }
    return <span key={i}>{p.t}</span>;
  });
}

function phraseFromParts(parts: InlinePart[], op: InlinePart["op"]) {
  return parts
    .filter((p) => p.op === op)
    .map((p) => p.t)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function insightForBlock(block: Block) {
  if (block.kind === "changed") {
    const added = phraseFromParts(block.new, "add");
    const removed = phraseFromParts(block.old, "del");
    return {
      title: `${block.label} is being revised`,
      purpose: "This is an amendment to existing law. It keeps the section in place, but changes the legal test or obligation inside it.",
      how: "Text highlighted in green is the proposed operative wording. Text highlighted in red is wording that would no longer govern once the bill is in force.",
      why: added
        ? `The practical review point is the new language: "${added}${added.length === 180 ? "..." : ""}".`
        : removed
          ? `The practical review point is what disappears: "${removed}${removed.length === 180 ? "..." : ""}".`
          : "The practical review point is whether the revised wording changes scope, timing, discretion, or compliance burden.",
    };
  }
  if (block.kind === "added") {
    return {
      title: `${block.label} would be added`,
      purpose: "This creates new statutory text. It is not just commentary; if enacted, it becomes part of the operative law.",
      how: "The new provision has to be read with the definitions, regulation-making powers, and coming-into-force language around it.",
      why: "For client impact, this is where new permissions, deadlines, review standards, or compliance duties usually appear.",
    };
  }
  if (block.kind === "removed") {
    return {
      title: `${block.label} would be removed`,
      purpose: "This deletes current statutory language. That can narrow a duty, remove a condition, or shift the legal analysis elsewhere.",
      how: "Counsel should confirm whether the bill replaces the rule in another section or truly removes the requirement.",
      why: "For client impact, deletions matter when existing policies, contracts, or operating procedures still assume the old rule applies.",
    };
  }
  return {
    title: `${block.label}`,
    purpose: "This section provides context for interpreting the amendment.",
    how: "Read it with the surrounding definitions and related provisions before treating the change as isolated.",
    why: "Context avoids overstating the client impact.",
  };
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
  const [openInsight, setOpenInsight] = useState<number | null>(null);
  const materialChanges = blocks.filter(
    (b) => b.kind === "changed" || b.kind === "added" || b.kind === "removed",
  ).length;

  const renderLabel = (label: string, index: number) => (
    <button
      type="button"
      className="diff-label-button"
      onClick={() => setOpenInsight((current) => (current === index ? null : index))}
      aria-expanded={openInsight === index}
    >
      {label}
    </button>
  );

  const renderSide = (b: Block, side: "L" | "R", index: number) => {
    const explain = () => setOpenInsight((current) => (current === index ? null : index));
    if (b.kind === "unchanged") {
      return (
        <div className="diff-block">
          <div className="lbl">{renderLabel(b.label, index)}</div>
          <div className="txt">{b.text}</div>
        </div>
      );
    }
    if (b.kind === "changed") {
      return (
        <div className="diff-block changed">
          <div className="lbl">{renderLabel(b.label, index)}</div>
          <div className="txt">{renderInline(side === "L" ? b.old : b.new, explain)}</div>
        </div>
      );
    }
    if (b.kind === "added") {
      if (side === "L") return <div className="diff-block diff-placeholder" />;
      return (
        <div className="diff-block added">
          <div className="lbl">{renderLabel(b.label, index)}</div>
          <div className="txt">{b.text}</div>
        </div>
      );
    }
    if (b.kind === "removed") {
      if (side === "R") return <div className="diff-block diff-placeholder" />;
      return (
        <div className="diff-block removed">
          <div className="lbl">{renderLabel(b.label, index)}</div>
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
          <span className="diff-kicker">
            <GitCompareArrows size={14} strokeWidth={1.8} aria-hidden="true" />
            Statutory comparator
          </span>
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
            {actCitation} <span className="diff-proposed-tag">(as proposed)</span>
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
          const insight = insightForBlock(b);
          return (
            <Fragment key={i}>
              <div>{renderSide(b, "L", i)}</div>
              <div>{renderSide(b, "R", i)}</div>
              {openInsight === i && (
                <div className="diff-insight-row">
                  <div className="diff-insight">
                    <div className="diff-insight-icon">
                      <Info size={15} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div>
                      <div className="diff-insight-title">{insight.title}</div>
                      <div className="diff-insight-grid">
                        <div>
                          <b>What it is for</b>
                          <span>{insight.purpose}</span>
                        </div>
                        <div>
                          <b>How it works</b>
                          <span>{insight.how}</span>
                        </div>
                        <div>
                          <b>Why it matters</b>
                          <span>{insight.why}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
