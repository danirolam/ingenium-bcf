import { diffArrays, diffWordsWithSpace } from "diff";
import { Fragment, useMemo, useState } from "react";

const TARGET_CONTEXT_CHARS = 100;

type Paragraph = { label: string; body: string };
type LegalChunk = { label: string; body: string; sourceIndex: number };
type InlinePart = { op: "eq" | "add" | "del"; t: string };

type Block =
  | { kind: "unchanged"; label: string; text: string }
  | { kind: "changed"; label: string; old: InlinePart[]; new: InlinePart[] }
  | { kind: "added"; label: string; text: string }
  | { kind: "removed"; label: string; text: string }
  | { kind: "identical-collapse"; paragraphs: LegalChunk[] };

type DiffEntry =
  | {
      kind: "equal";
      chunks: LegalChunk[];
      oldStart: number;
      newStart: number;
    }
  | { kind: "changed"; label: string; old: InlinePart[]; new: InlinePart[] }
  | { kind: "added"; label: string; text: string }
  | { kind: "removed"; label: string; text: string };

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

function splitLegalUnits(body: string): string[] {
  const protectedBody = body.replace(
    /\b(s|ss|No|Nos|Art|para|subpara)\.\s+/gi,
    (m) => m.replace(".", "<DOT>"),
  );
  return protectedBody
    .split(/(?<=[.;:])\s+(?=(?:\(?[a-zA-Z0-9]+\)|[A-Z]))/g)
    .map((part) => part.replaceAll("<DOT>", ".").trim())
    .filter(Boolean);
}

function segmentLegalText(text: string): LegalChunk[] {
  return splitParas(text).flatMap((p, sourceIndex) => {
    const units = splitLegalUnits(p.body);
    const baseLabel = p.label.replace(/\.$/, "");
    return units.map((body, unitIndex) => ({
      label: unitIndex === 0 ? p.label : `${baseLabel}.${unitIndex + 1}`,
      body,
      sourceIndex,
    }));
  });
}

function collectContextIndexes(
  chunks: LegalChunk[],
  materialIndexes: Set<number>,
): Set<number> {
  const context = new Set<number>();
  for (const idx of materialIndexes) {
    let chars = 0;
    for (let i = idx - 1; i >= 0; i--) {
      context.add(i);
      chars += chunks[i].body.length;
      if (chars >= TARGET_CONTEXT_CHARS) break;
    }

    chars = 0;
    for (let i = idx + 1; i < chunks.length; i++) {
      context.add(i);
      chars += chunks[i].body.length;
      if (chars >= TARGET_CONTEXT_CHARS) break;
    }
  }
  return context;
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
  const left = segmentLegalText(oldText);
  const right = segmentLegalText(newText);

  // diffArrays aligns legal text chunks across insertions/deletions correctly.
  const changes = diffArrays(left, right, {
    comparator: (a, b) => (a as LegalChunk).body === (b as LegalChunk).body,
  });

  const entries: DiffEntry[] = [];
  const oldMaterialIndexes = new Set<number>();
  const newMaterialIndexes = new Set<number>();
  let oldCursor = 0;
  let newCursor = 0;

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const chunks = c.value as LegalChunk[];

    if (!c.added && !c.removed) {
      entries.push({
        kind: "equal",
        chunks,
        oldStart: oldCursor,
        newStart: newCursor,
      });
      oldCursor += chunks.length;
      newCursor += chunks.length;
      continue;
    }

    // Pair a removed run immediately followed by an added run as a sequence
    // of word-level "changed" blocks (one per paired legal chunk).
    if (c.removed && i + 1 < changes.length && changes[i + 1].added) {
      const next = changes[i + 1];
      const removedChunks = chunks;
      const addedChunks = next.value as LegalChunk[];
      const pairLen = Math.min(removedChunks.length, addedChunks.length);
      for (let k = 0; k < pairLen; k++) {
        const L = removedChunks[k];
        const R = addedChunks[k];
        const { oldParts, newParts } = inlineParts(L.body, R.body);
        entries.push({
          kind: "changed",
          label: R.label || L.label,
          old: oldParts,
          new: newParts,
        });
        oldMaterialIndexes.add(oldCursor + k);
        newMaterialIndexes.add(newCursor + k);
      }
      // Surplus removed (deletion-only at the end of the removed run)
      for (let k = pairLen; k < removedChunks.length; k++) {
        const oldIndex = oldCursor + k;
        oldMaterialIndexes.add(oldIndex);
        entries.push({
          kind: "removed",
          label: removedChunks[k].label,
          text: removedChunks[k].body,
        });
      }
      // Surplus added (extra new paragraphs)
      for (let k = pairLen; k < addedChunks.length; k++) {
        const newIndex = newCursor + k;
        newMaterialIndexes.add(newIndex);
        entries.push({
          kind: "added",
          label: addedChunks[k].label,
          text: addedChunks[k].body,
        });
      }
      oldCursor += removedChunks.length;
      newCursor += addedChunks.length;
      i += 1; // skip the paired added change
      continue;
    }

    if (c.added) {
      for (let k = 0; k < chunks.length; k++) {
        const newIndex = newCursor + k;
        newMaterialIndexes.add(newIndex);
        entries.push({
          kind: "added",
          label: chunks[k].label,
          text: chunks[k].body,
        });
      }
      newCursor += chunks.length;
    } else if (c.removed) {
      for (let k = 0; k < chunks.length; k++) {
        const oldIndex = oldCursor + k;
        oldMaterialIndexes.add(oldIndex);
        entries.push({
          kind: "removed",
          label: chunks[k].label,
          text: chunks[k].body,
        });
      }
      oldCursor += chunks.length;
    }
  }

  const oldContextIndexes = collectContextIndexes(left, oldMaterialIndexes);
  const newContextIndexes = collectContextIndexes(right, newMaterialIndexes);
  const blocks: Block[] = [];

  for (const entry of entries) {
    if (entry.kind !== "equal") {
      blocks.push(entry);
      continue;
    }

    let collapsedRun: LegalChunk[] = [];
    const flushCollapsedRun = () => {
      if (collapsedRun.length > 0) {
        blocks.push({
          kind: "identical-collapse",
          paragraphs: collapsedRun,
        });
        collapsedRun = [];
      }
    };

    for (let k = 0; k < entry.chunks.length; k++) {
      const chunk = entry.chunks[k];
      const isContext =
        oldContextIndexes.has(entry.oldStart + k) ||
        newContextIndexes.has(entry.newStart + k);

      if (isContext) {
        flushCollapsedRun();
        blocks.push({
          kind: "unchanged",
          label: chunk.label,
          text: chunk.body,
        });
      } else {
        collapsedRun.push(chunk);
      }
    }
    flushCollapsedRun();
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
                  {b.paragraphs.length} unchanged legal unit
                  {b.paragraphs.length === 1 ? "" : "s"}
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
                  Hide {b.paragraphs.length} unchanged legal unit
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
