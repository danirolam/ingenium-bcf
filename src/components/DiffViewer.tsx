import { diffArrays, diffWordsWithSpace } from "diff";
import { Fragment, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo, faCodeCompare } from "@fortawesome/free-solid-svg-icons";

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
  | { kind: "equal"; chunks: LegalChunk[]; oldStart: number; newStart: number }
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
      entries.push({ kind: "equal", chunks, oldStart: oldCursor, newStart: newCursor });
      oldCursor += chunks.length;
      newCursor += chunks.length;
      continue;
    }

    if (c.removed && i + 1 < changes.length && changes[i + 1].added) {
      const addedChunks = changes[i + 1].value as LegalChunk[];
      const pairLen = Math.min(chunks.length, addedChunks.length);
      for (let k = 0; k < pairLen; k++) {
        const L = chunks[k];
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
      for (let k = pairLen; k < chunks.length; k++) {
        oldMaterialIndexes.add(oldCursor + k);
        entries.push({ kind: "removed", label: chunks[k].label, text: chunks[k].body });
      }
      for (let k = pairLen; k < addedChunks.length; k++) {
        newMaterialIndexes.add(newCursor + k);
        entries.push({
          kind: "added",
          label: addedChunks[k].label,
          text: addedChunks[k].body,
        });
      }
      oldCursor += chunks.length;
      newCursor += addedChunks.length;
      i += 1;
      continue;
    }

    if (c.added) {
      for (let k = 0; k < chunks.length; k++) {
        newMaterialIndexes.add(newCursor + k);
        entries.push({ kind: "added", label: chunks[k].label, text: chunks[k].body });
      }
      newCursor += chunks.length;
    } else if (c.removed) {
      for (let k = 0; k < chunks.length; k++) {
        oldMaterialIndexes.add(oldCursor + k);
        entries.push({ kind: "removed", label: chunks[k].label, text: chunks[k].body });
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
        blocks.push({ kind: "identical-collapse", paragraphs: collapsedRun });
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
        blocks.push({ kind: "unchanged", label: chunk.label, text: chunk.body });
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

function insightForBlock(block: Exclude<Block, { kind: "identical-collapse" }>) {
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
      purpose: "This creates new statutory text. It is not commentary; if enacted, it becomes part of the operative law.",
      how: "The new provision has to be read with definitions, regulation-making powers, and coming-into-force language around it.",
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
  const [openInsight, setOpenInsight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggleCollapsed = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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
            <FontAwesomeIcon icon={faCodeCompare} aria-hidden="true" />
            Statutory comparator
          </span>
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
          <div className="vvalue">{versionALabel}</div>
        </div>
        <div className="diff-version">
          <div className="vlabel">To</div>
          <div className="vvalue">{versionBLabel}</div>
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
            {actCitation} {proposed && <span className="diff-proposed-tag">(as proposed)</span>}
          </div>
        </div>

        {blocks.map((b, i) => {
          if (b.kind === "identical-collapse") {
            const isOpen = expanded.has(i);
            if (!isOpen) {
              return (
                <button
                  className="diff-collapse"
                  key={i}
                  type="button"
                  onClick={() => toggleCollapsed(i)}
                  title="Click to expand"
                >
                  {b.paragraphs.length} unchanged legal unit
                  {b.paragraphs.length === 1 ? "" : "s"}
                </button>
              );
            }
            return (
              <Fragment key={i}>
                <button
                  className="diff-collapse"
                  type="button"
                  onClick={() => toggleCollapsed(i)}
                  title="Click to collapse"
                >
                  Hide {b.paragraphs.length} unchanged legal unit
                  {b.paragraphs.length === 1 ? "" : "s"}
                </button>
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
          const insight = insightForBlock(b);
          return (
            <Fragment key={i}>
              <div>{renderSide(b, "L", i)}</div>
              <div>{renderSide(b, "R", i)}</div>
              {openInsight === i && (
                <div className="diff-insight-row">
                  <div className="diff-insight">
                    <div className="diff-insight-icon">
                      <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
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
