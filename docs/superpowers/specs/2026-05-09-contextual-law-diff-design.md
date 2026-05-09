# Contextual Law Diff Design

## Goal

The Delta Workspace should show law changes in a GitHub-like review mode: material changes stay visible, while unchanged legal text is collapsed except for a small amount of surrounding context.

## Selected Approach

Use sentence/clause-level chunks rather than paragraph-level blocks.

The current `DiffViewer` splits text into paragraphs and collapses only long identical paragraph runs. That is too coarse for legal text because a single paragraph can contain many obligations, definitions, and exceptions. The new design will keep paragraphs as source containers, but split their bodies into smaller legal chunks before diffing.

## Diff Pipeline

1. `segmentLegalText(text)` converts text into ordered chunks.
   - Preserve labels such as section numbers where possible.
   - Split each paragraph into sentence-like or clause-like units.
   - Keep stable order and enough metadata to render the chunk label.

2. `buildDiffBlocks(oldText, newText)` diffs chunk arrays.
   - Equal chunk runs become contextual/collapsible unchanged blocks.
   - Added, removed, and changed chunk pairs remain material blocks.
   - Removed followed by added continues to render as a changed pair with inline word highlights.

3. Context behavior:
   - Around each material change, show nearby unchanged chunks as context.
   - Distant unchanged chunks collapse into a compact row.
   - The target context is roughly 100 characters before and after changes, implemented through adjacent sentence/clause chunks so legal text remains readable.

## Rendering

The side-by-side `DiffViewer` layout remains. Each chunk renders like a line in the diff:

- unchanged context: neutral block
- changed: old/new blocks with inline deletion/addition highlights
- added: blank left side, added right side
- removed: removed left side, blank right side
- collapsed unchanged: one full-width clickable row showing how much content is hidden

Users can expand collapsed unchanged rows when they need the full legal text.

## Testing

The build must pass TypeScript/Vite production build. Because this is a UI behavior change, verify the Delta Workspace manually in the browser if a representative bill delta is available.
