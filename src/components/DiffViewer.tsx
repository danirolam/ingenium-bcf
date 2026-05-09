import { diffArrays, diffWordsWithSpace } from "diff";
import { Fragment, useMemo, useState } from "react";

const COLLAPSE_THRESHOLD = 3;

type Paragraph = { label: string; body: string };
type InlinePart = { op: "eq" | "add" | "del"; t: string };

type Block =
  | { kind: "unchanged"; label: string; text: string }
  | { kind: "changed"; label: string; old: InlinePart[]; new: InlinePart[] }
  | { kind: "added"; label: string; text: string }
  | { kind: "removed"; label: string; text: string }
  | { kind: "identical-collapse"; paragraphs: Paragraph[] };

function splitParas(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para, i) => {
      const m = para.match(
        /^(Section\s+\d+[^.]*\.|s\.\s*\d+(?:\([^)]+\))?|\([\d\w]+\)|\d+\.\s)\s*(.*)$/s,
      );
      const label = m ? m[1].trim() : `¶ ${i + 1}`;
      const body = m ? (m[2] || para).trim() : para;
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

  // diffArrays aligns paragraph runs across insertions/deletions correctly.
  const changes = diffArrays(left, right, {
    comparator: (a, b) => (a as Paragraph).body === (b as Paragraph).body,
  });

  const blocks: Block[] = [];

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const ps = c.value as Paragraph[];

    if (!c.added && !c.removed) {
      if (ps.length >= COLLAPSE_THRESHOLD) {
        blocks.push({ kind: "identical-collapse", paragraphs: ps });
      } else {
        for (const p of ps) {
          blocks.push({ kind: "unchanged", label: p.label, text: p.body });
        }
      }
      continue;
    }

    // Pair a removed run immediately followed by an added run as a sequence
    // of word-level "changed" blocks (one per paired index).
    if (c.removed && i + 1 < changes.length && changes[i + 1].added) {
      const next = changes[i + 1];
      const removedPs = ps;
      const addedPs = next.value as Paragraph[];
      const pairLen = Math.min(removedPs.length, addedPs.length);
      for (let k = 0; k < pairLen; k++) {
        const L = removedPs[k];
        const R = addedPs[k];
        const { oldParts, newParts } = inlineParts(L.body, R.body);
        blocks.push({
          kind: "changed",
          label: R.label || L.label,
          old: oldParts,
          new: newParts,
        });
      }
      // Surplus removed (deletion-only at the end of the removed run)
      for (let k = pairLen; k < removedPs.length; k++) {
        blocks.push({
          kind: "removed",
          label: removedPs[k].label,
          text: removedPs[k].body,
        });
      }
      // Surplus added (extra new paragraphs)
      for (let k = pairLen; k < addedPs.length; k++) {
        blocks.push({
          kind: "added",
          label: addedPs[k].label,
          text: addedPs[k].body,
        });
      }
      i += 1; // skip the paired added change
      continue;
    }

    if (c.added) {
      for (const p of ps) {
        blocks.push({ kind: "added", label: p.label, text: p.body });
      }
    } else if (c.removed) {
      for (const p of ps) {
        blocks.push({ kind: "removed", label: p.label, text: p.body });
      }
    }
  }

  return blocks;
}

export function countMaterialChanges(blocks: Block[]): {
  added: number;
  removed: number;
  changed: number;
  total: number;
} {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const b of blocks) {
    if (b.kind === "added") added++;
    else if (b.kind === "removed") removed++;
    else if (b.kind === "changed") changed++;
  }
  return { added, removed, changed, total: added + removed + changed };
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
  proposed = true,
}: {
  actName: string;
  actCitation: string;
  oldText: string;
  newText: string;
  versionALabel: string;
  versionBLabel: string;
  proposed?: boolean;
}) {
  const blocks = useMemo(() => buildDiffBlocks(oldText, newText), [oldText, newText]);
  const counts = useMemo(() => countMaterialChanges(blocks), [blocks]);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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
            {counts.total} material change{counts.total === 1 ? "" : "s"}
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
            {actCitation}{" "}
            {proposed && (
              <span style={{ color: "var(--accent)" }}>(as proposed)</span>
            )}
          </div>
        </div>

        {blocks.map((b, i) => {
          if (b.kind === "identical-collapse") {
            const isOpen = expanded.has(i);
            if (!isOpen) {
              return (
                <div
                  className="diff-collapse"
                  key={i}
                  onClick={() => toggle(i)}
                  role="button"
                  style={{ cursor: "pointer", userSelect: "none" }}
                  title="Click to expand"
                >
                  {b.paragraphs.length} identical paragraph
                  {b.paragraphs.length === 1 ? "" : "s"} · click to expand
                </div>
              );
            }
            return (
              <Fragment key={i}>
                <div
                  className="diff-collapse"
                  onClick={() => toggle(i)}
                  role="button"
                  style={{ cursor: "pointer", userSelect: "none" }}
                  title="Click to collapse"
                >
                  Hide {b.paragraphs.length} identical paragraph
                  {b.paragraphs.length === 1 ? "" : "s"}
                </div>
                {b.paragraphs.map((p, j) => (
                  <Fragment key={`${i}-${j}`}>
                    <div>
                      <div className="diff-block">
                        <div className="lbl">{p.label}</div>
                        <div className="txt">{p.body}</div>
                      </div>
                    </div>
                    <div>
                      <div className="diff-block">
                        <div className="lbl">{p.label}</div>
                        <div className="txt">{p.body}</div>
                      </div>
                    </div>
                  </Fragment>
                ))}
              </Fragment>
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
