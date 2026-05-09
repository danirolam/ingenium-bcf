# Contextual Law Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Delta Workspace law diffs as focused sentence/clause-level change groups with collapsed distant unchanged text.

**Architecture:** Keep the existing `DiffViewer` component and side-by-side layout, but replace paragraph-only diff blocks with legal text chunks. Equal chunk runs become either visible context or collapsed rows depending on proximity to material changes.

**Tech Stack:** React 18, TypeScript, Vite, `diff` package.

---

### Task 1: Add Focused Diff Segmentation

**Files:**
- Modify: `src/components/DiffViewer.tsx`

- [x] **Step 1: Add legal chunk types**

Add `LegalChunk`, make unchanged blocks track paragraphs, and define constants:

```ts
const TARGET_CONTEXT_CHARS = 100;

type LegalChunk = { label: string; body: string; sourceIndex: number };
type Block =
  | { kind: "unchanged"; label: string; text: string }
  | { kind: "changed"; label: string; old: InlinePart[]; new: InlinePart[] }
  | { kind: "added"; label: string; text: string }
  | { kind: "removed"; label: string; text: string }
  | { kind: "identical-collapse"; paragraphs: Paragraph[] };
```

- [x] **Step 2: Replace paragraph splitting for diff input**

Keep `splitParas`, then add `splitLegalUnits`, `segmentLegalText`, and `collectContextIndexes`:

```ts
function splitLegalUnits(body: string): string[] {
  const protectedBody = body.replace(/\b(s|ss|No|Nos|Art|para|subpara)\.\s+/gi, (m) =>
    m.replace(".", "<DOT>"),
  );
  return protectedBody
    .split(/(?<=[.;:])\s+(?=(?:\(?[a-zA-Z0-9]+\)|[A-Z]))/g)
    .map((part) => part.replaceAll("<DOT>", ".").trim())
    .filter(Boolean);
}

function segmentLegalText(text: string): LegalChunk[] {
  return splitParas(text).flatMap((p, sourceIndex) => {
    const units = splitLegalUnits(p.body);
    return units.map((body, unitIndex) => ({
      label: unitIndex === 0 ? p.label : `${p.label}.${unitIndex + 1}`,
      body,
      sourceIndex,
    }));
  });
}

function collectContextIndexes(chunks: LegalChunk[], materialIndexes: Set<number>): Set<number> {
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
```

- [x] **Step 3: Update `buildDiffBlocks`**

Diff `LegalChunk[]`, track equal and material chunk indexes, render visible context as unchanged, and collapse distant equal runs.

- [x] **Step 4: Run build**

Run: `npm run build`

Expected: Vite build completes successfully.

### Task 2: Verify Focused Diff Rendering

**Files:**
- Modify if needed: `src/components/DiffViewer.tsx`
- Modify if needed: `src/styles/app.css`

- [x] **Step 1: Start the app**

Run: `npm run dev`

Expected: Vite and API server start.

- [ ] **Step 2: Open the Delta Workspace**

Use the browser at the local dev URL and open a representative bill delta.

Expected: Changed legal chunks are visible with nearby context. Long unchanged runs are collapsed and expandable.

Note: Browser opened the local app, but the API instance on port `8787` had no seeded bills, so this was verified with focused `buildDiffBlocks` checks instead of a representative Delta Workspace screen.

- [x] **Step 3: Polish only if needed**

If collapsed rows or context lines look cramped, adjust existing diff styles in `src/styles/app.css` without changing the app layout.

- [x] **Step 4: Final build**

Run: `npm run build`

Expected: Vite build completes successfully.
