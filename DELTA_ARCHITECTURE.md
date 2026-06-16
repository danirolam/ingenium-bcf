# How the Legal Delta works (Stage 2)

This explains how Ingenium turns a bill into **the exact change it makes to the law** —
the side-by-side "here's the Act before, here's the Act after" diff you approve in the
Legal-delta stage. It's the most intricate part of the app, so this doc keeps it plain.

(For keys, providers, and the no-key fallbacks, see `AI_INTEGRATION.md`. This doc is
about the pipeline itself.)

## The problem

A bill doesn't hand you a clean edit. It gives you **instructions in prose**:

> *Subsection 30(1) of the Act is amended by adding the following after paragraph (j):*

A human lawyer reads that, opens the real Act, finds subsection 30(1), scrolls to
paragraph (j), and slots the new paragraph in after it. The catch: **the bill never
says, in any machine-readable way, where that spot is.** The location lives only in
that English sentence. Worse, one clause can bundle several edits, and the wording
varies endlessly ("striking out", "is replaced by", "is repealed", "in alphabetical
order"…).

We used to match that sentence against the Act with string/regex rules. It was
brittle — it would silently put a change in the *wrong* place. So we rebuilt it.

## The core idea

**A provision's identity is its citation path** — the chain of ancestors that points
to it:

```
Food and Drugs Act → section 30 → subsection (1) → paragraph (j)
```

That path both *identifies* an existing provision and *describes where a new one
goes* (which is why it works for additions, whose target doesn't exist yet).

So the job splits cleanly:

- **The AI does the reading.** We hand it one amendment's text; it navigates the real
  Act (like a lawyer) and tells us just two things: **what operation** (add / replace /
  amend / repeal) and **the citation path**.
- **Our code does the editing.** We verify that path against the real Act, then
  deterministically apply the change. **The AI never writes legal text** — the new
  wording comes verbatim from the bill's own XML, which we parse reliably.

That division is the whole trick: the AI handles the fuzzy part (where does this go?),
and plain code handles the part that must be exact (changing the law).

## The pipeline: Extract → Locate → Apply → Diff

```
bill XML ──Extract──▶ amendment units ──Locate (AI)──▶ {op, path} ──Apply──▶ new Act tree ──Diff──▶ rows you review
            (no AI)                       (per unit)        (verified)   (deterministic)
```

**1. Extract** — `billAmendments.ts`
Parse the bill XML into discrete **amendment units**. Each unit is one instruction
plus the structured new provisions it inserts (already labelled, e.g. the new
`(j.01)`). This is pure parsing — no AI. It also pulls Part/Division headings, schedule
entries, and the Act each clause targets.

**2. Locate** — `amendmentLocator.ts` *(the AI step)*
For **each** amendment unit, one focused AI conversation:
- It's given the amendment text + the labels of the new provisions, and a set of
  **tools to navigate the Act** (read a provision, list children, search, etc. — see
  below).
- It explores until it finds the spot, then calls `validate_operation`, which checks
  the answer deterministically (does the parent exist? does the new label collide?
  where does it sort in?). The model **must** reach `ok: true`.
- It returns `{ operation, actSlug, ancestors[] }`. Our code re-validates it from
  scratch before trusting it.
- Units run a few at a time; an unlocatable one becomes a **surfaced failure**, never
  a silent mis-placement.

**3. Apply** — `amendmentApply.ts`
Clone the Act's provision tree and **mutate it** at the resolved path: insert (sorted
into the right spot among siblings), replace text, repeal (remove), or amend (a small
in-place text edit). Re-flatten the tree → document order falls out for free.

**4. Diff** — `amendmentEngine.ts`
Compare the before-tree and after-tree by each provision's stable id. The result is
the list of **rows** (unchanged / added / changed / repealed) the UI renders as the
side-by-side review.

## Why you can trust it

- **The AI points; it never writes the law.** Operation + location only. Inserted and
  replacement text is the bill's own verbatim text.
- **Everything the AI says is re-checked by code** before it's applied — the model's
  own confidence is never the gate.
- **Nothing is placed silently.** If a change can't be confidently located, it shows
  up as a visible "couldn't be located — verify against the PDF" item.
- **Deterministic where it counts.** Temperature 0, one model for the job, and a
  retry when a response comes back malformed — so the same bill resolves the same way.

## The locator's toolset (how it navigates like a lawyer)

| Tool | What it does |
|---|---|
| `list_acts` | List the Acts it can navigate (when a clause's target Act is untagged) |
| `get_provision` | Read a provision at a path — its text, children, and siblings — or the exact level that doesn't exist |
| `list_children` | List what's directly under a path (to find where an insert belongs) |
| `get_neighbors` | Read a provision plus the few before/after it, for context |
| `search_text` | Find provisions whose text contains a phrase |
| `search_marginal_notes` | Search the Act's own headings/notes |
| `find_definition` | Locate a defined term |
| `validate_operation` | Deterministically check a candidate `{op, path}` — the authoritative gate |

When a path is wrong, the tools return a **granular error** ("section 30 exists but has
no subsection (4); present here: (1), (2), (3)") so the model self-corrects instead of
guessing.

## File map

| File | Role |
|---|---|
| `server/services/billAmendments.ts` | **Extract** — bill XML → amendment units (deterministic) |
| `server/services/lawTree.ts` | The navigable Act tree, the `LawNavigator`, the legislative label comparator, and the flatten that produces the rows |
| `server/services/amendmentLocator.ts` | **Locate** — the per-amendment AI tool-use loop |
| `server/services/amendmentApply.ts` | **Apply** — deterministic tree mutation |
| `server/services/amendmentEngine.ts` | **Diff** — before/after → rows; op→row linking |
| `server/services/anthropic.ts` | One Anthropic call, with rate-limit backoff |
| `server/services/aiBudget.ts` | Shared abort / "this run is incomplete" coordination across a request's AI calls |
| `server/routes/bills.ts` | Orchestrates Extract→Locate→Apply→Diff for `POST /api/bills/:id/provision-delta`, caches the result, and gates approvals |

## A few details worth knowing

- **Multi-Act bills** produce one delta per Act (a bill amending 5 Acts → 5 deltas).
  The review pager walks every amendment across every Act; export is per-Act.
- **Caching.** A bill's delta is computed once and cached; `?refresh=1` recomputes it.
  A recompute **clears that bill's approvals**, since the new delta's placements must be
  re-approved.
- **Rate limits self-heal.** A 429 backs off and retries; if a run is cut short it
  returns what it has, clearly marked "partial", and retries next time rather than
  caching a half-answer.
- **No key, no problem.** Without `ANTHROPIC_API_KEY` the app still runs on
  deterministic fallbacks — amendments that need the locator simply show as
  unresolved rather than guessing.
