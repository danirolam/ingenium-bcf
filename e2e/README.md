# Injenium E2E suite (`e2e/`)

Isolated Playwright harness for the client pipeline — **stage 3 (Client Scan)**
and **stage 4 (Client Brief)**. This directory is its own npm package: nothing
here touches the root `package.json`, `src/` or `server/` code.

## Run it

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

**Ports 5173 and 8787 must be free** — stop your own dev server first.
The suite always boots its own `npm run dev` (`reuseExistingServer: false`):
determinism beats convenience, because the managed server is started with
`ANTHROPIC_API_KEY=""`, `GEMINI_API_KEY=""` and `RESEND_API_KEY=""`. Empty
strings are *defined*, so the server's `loadEnv()` won't pull the real keys
out of `.env`, and they're *falsy*, so every AI/email call takes its
deterministic keyless fallback path.

First run on a fresh clone: `server/data/*.json` is gitignored; the dev
server's `seedDemo()` creates `bills.json` at boot and the global setup waits
for it (up to 2 minutes).

Useful variants:

```bash
npx playwright test tests/smoke.spec.ts   # the always-green proof-of-life
npx playwright test --list                # discover every spec without running
npm run seed:setup && npm run seed:teardown   # drive the seeder by hand
```

## The DEMO fixture (separate from the test fixture)

`npm run seed:demo` (`seed-demo.ts`) makes the **real Bill C-265** (45-1,
amending the Food and Drugs Act) scan-ready — six approved operations anchored
to real provisions of the ingested Act — and upserts the two demo clients it
affects (Aurelia Therapeutics, Lakehead Regional Health Network). Its delta and
approval records carry `__demoSeed` (not `__e2eSeed`) and the clients are
id-protected, so the Playwright teardown leaves all of it intact; the suite and
the demo fixture coexist. The two runtime stores are gitignored — re-run
`seed:demo` after any data reset. It is idempotent (replaces its own records).

## What gets seeded (and cleaned)

`seed.ts` runs as `globalSetup`/`globalTeardown`:

- Picks **two real bills** from `server/data/bills.json`, deterministically:
  old session (not `45-1`), empty/missing `clauses`, not pro-forma — pure
  metadata records that collide with nothing in the demo.
- Injects into `server/data/provisionDeltas.json` (marker: `__e2eSeed: true`):
  - bill 1: a delta for the **E2E Test Act** (`e2e-test-act`, "TEST 2026,
    c. 1") with 3 ops — add / replace / repeal of sections 1–3 — and matching
    diff rows; plus an `approvals.json` record approving all 3 keys
    (`e2e-test-act#0..2`). This bill is **scan-ready**.
  - bill 2: a delta for the **E2E Second Act** but **no approvals record** —
    it must *never* show up as scan-ready.
- Records identity in `e2e/.seed-state.json` (gitignored; specs read it).

Teardown is surgical and idempotent (setup also runs it first to clear strays):

- drops `__e2eSeed` records from `provisionDeltas.json`,
- drops the seeded bills' `approvals.json` records,
- drops `clientImpactAnalyses.json` records whose `billId` is a seeded bill,
- drops clients whose name starts with `"E2E "` — the three demo clients
  (`client-corebloom`, `client-northcedar-elections`, `client-prairie-agri`)
  are additionally id-protected and are never touched,
- deletes files it created itself once they're empty again, restoring
  `server/data/` byte-identically for everything it didn't seed.

## Live test (real AI keys)

`tests/live.spec.ts` (tagged `@live`) is skipped by default. It asserts the
*real* AI path produces a non-fallback analysis, so it needs your keyed server:

```bash
# terminal 1, repo root — your own server, with the real .env keys
npm run dev

# terminal 2
cd e2e && npm run test:live
```

With `RUN_LIVE=1` the config manages **no** webServer; the spec talks directly
to your server on `:8787`. Global setup/teardown still run, so the seeded bill
exists for the analyze call and is cleaned afterwards.

## Spec inventory — what depends on what

| Spec | Verifies | Passes today? | Unblocked by |
| --- | --- | --- | --- |
| `smoke.spec.ts` | server boot, env blanking, `/` renders | **yes** | — |
| `api.spec.ts` | scan-ready list/detail/404, scorer (`/scan` + `/scans`: bands, determinism, no-score-leak, cascade), analyze 400/404, keyless analyze + by-pair, brief library (FLAT `/briefs` index: entry shape, `approved:false` on fresh briefs, createdAt-desc + analysisId tiebreak, band join, no-score-leak; `POST /:id/save` → `approved:true` flip; `guidance` on `/analyze`), client CRUD + cascade | **yes** (flat library + approval backend landed, 3ed4cf2) | — |
| `approval.spec.ts` | counsel-approval gate on the brief page: Needs review → Approve → `approved-badge`, Download/Email locked until approved, `/brief` tag flips; answerable Lawyer Review (`review-answer-input` → `regen-with-answers` → NEW unapproved version, gate re-engages, answers clear) | **yes** (3ed4cf2) | — |
| `core-unit.spec.ts` | `clientScanCore.ts` pure functions incl. `bandFromScore`/`normalizeScore`/`heuristicScore` laws, `serializeBillStatus` (never-throws, not-law caveat, bounded) and the multi-Act laws (serializer/triage/chunker/heuristic keep ops attributed to their Act) — a missing/broken module FAILS the suite | **yes** | — |
| `scan-ready.spec.ts` | ready list / approved summary UI | **yes** | — |
| `brief-picker.spec.ts` | stage-4 flat library (`/brief`): chronological `brief-entry` rows, exactly-one-tag law, bill+client filters AND-combine and reset, row click opens the brief page, regen-with-guidance panel | **yes** (flat-library frontend landed, 3ed4cf2) | — |
| `scan-flow.spec.ts` | two-phase flow: band scoreboard → rationale accordion → single-action-slot analyze (slot swaps to view-brief) → brief → persistence | **yes** | — |
| `empty-states.spec.ts` | run-scan disabled guards | **yes** (Phase 2C frontend landed) | — |
| `client-management.spec.ts` | client modal CRUD UI | **yes** (Phase 2C frontend landed) | — |
| `live.spec.ts` | real AI analysis (opt-in `@live`) | opt-in | real keys + your running server |

## Selector / behavior contract the frontend implements

Stage-3 selectors are the agreed `data-testid` contract (`ready-bill-list`,
`ready-bill-card[data-bill-id]`, `approved-summary`, `approved-act[data-slug]`,
`approved-op[data-key]`, `client-list`, `client-row[data-client-id]`,
`client-checkbox`, `select-all-clients`, `new-client-button`, `client-modal`,
`client-*-input`, `client-modal-save`, `edit-client`, `delete-client`,
`confirm-delete-client`, `run-scan`, `scan-row[data-client-id]`,
`scan-status` with exact text `queued|scoring|scored|failed`, `scan-band[data-band]`,
`scan-rationale-toggle`, `scan-rationale` (accordion — at most ONE visible at a
time), and the **single action slot**: every scored row renders EXACTLY ONE of
`analyze-client` | `view-brief` — uniform "Analyze" copy on every un-analyzed
row (there is no "Analyze anyway"), and after a successful analyze the SAME
slot swaps to `view-brief`. `scan-retry` appears on failed rows only (never on
scored rows). `expectSingleActionSlot` in `helpers.ts` encodes the slot law.

### The scorer contract (two-agent split)

`POST /api/client-impact/scan {clientId, billId}` returns a **band-only** view
(`band`, `rationale`, `topAreas`, `source`, `hasBrief`); the numeric 0–100
score is backend-only ranking state and must NEVER appear in any response —
`api.spec.ts` enforces this on both the single-scan and `/scans` list shapes.
Keyless runs use the deterministic `heuristicScore` fallback, so scan results
are stable in CI. `GET /api/client-impact/scans?billId=…` is the persisted,
pre-ranked scoreboard feed (latest-wins per pair).

`GET /api/client-impact/briefs` is the brief-library index behind `/brief` —
**FLAT** since 3ed4cf2: a `BriefIndexEntry[]` (`analysisId`, `billId`,
`billNumber`, `billTitle`, `billShortTitle?`, `clientId`, `clientName`,
`createdAt`, `band?`, `approved`), one entry per latest-(client, bill) pair,
sorted `createdAt` desc with an `analysisId` tiebreak. `approved` mirrors the
analysis' stored `saved` flag — `POST /api/client-impact/:id/save` is the
counsel-approval flip (404 on unknown ids); a fresh or regenerated brief always
indexes `approved:false`. The band joins from the scans store iff the pair was
scanned — never the numeric score. `POST /analyze` also accepts an optional
**transient** `guidance` string (≤2000 chars — counsel instructions/feedback
AND the composed verification-question answers ride this same channel, never
persisted on the analysis); keyless servers still answer 200 via the fallback.

Two behavioral notes encoded in the specs:

- `client-checkbox` is the checkable element itself (`<input type="checkbox">`
  or `[role="checkbox"]`) — the helpers drive it with `setChecked`.
- `select-all-clients` toggles between all-selected and none-selected; the
  specs settle exact state checkbox-by-checkbox afterwards, so either initial
  selection state is fine.

Stage-4 (Client Brief) selectors are derived from the page as it ships today
(`src/pages/ClientImpactAnalysis.tsx`): the `Client Brief — …` `h1`, the
`Summary` card, the `Needs review` badge (unapproved versions) and the
`Lawyer review` / `Review before sending` section. The old "Executive read"
cell is gone ("Why it matters" remains).

### The counsel-approval gate (stage 4)

`approval.spec.ts` is the acceptance test. Approval repurposes the stored
`saved` flag via the existing `POST /:id/save` route:

- A fresh (or regenerated) brief is **unapproved**: the `Needs review` badge
  shows, `approve-brief` is enabled with the text "Approve & generate email",
  and the **Download brief / Email lawyer buttons are `disabled`** — unapproved
  AI output cannot leave the building.
- The **client email draft is deferred to approval** (so regenerations don't
  spend tokens drafting an email that gets discarded). Pre-approval the Email
  draft section shows a placeholder (`email-draft-pending`, summary "Generated
  when you approve the brief"), and `analysis.emailDraft` is absent on the
  `/analyze` response.
- Clicking `approve-brief` flips the gate **and generates the email**: `POST
  /:id/save` returns the analysis with a populated `emailDraft` (a focused AI
  call; the deterministic fallback when keyless). `approved-badge` ("Counsel
  approved") replaces the review badge, Download/Email enable, the button reads
  "Approved" (disabled), and the Email draft section shows the draft
  (`email-draft-content`). The `/brief` library tags the entry
  `brief-tag-approved`.
- Approval is **per-version**: any regeneration (plain, with guidance, or with
  answers) produces a new unapproved analysis, so the badge, the export locks,
  the library tag and the (deferred-again) email draft all revert until counsel
  approves again.
- The brief summary's `ImpactScale` shows **Impact level** only — with an
  `impact-level-info` hover explaining how it's computed; the Urgency readout
  was removed.

### The answerable Lawyer Review (answers ride the guidance channel)

Each verification question in the `Lawyer review` section carries a
`review-answer-input` textarea. `regen-with-answers` is enabled only while
**≥1 answer is non-empty**; clicking it composes the verbatim Q/A pairs and
sends them through the SAME transient `guidance` channel as free-form feedback
(2000-char server cap; the frontend truncates at a pair boundary so no
half-answer goes through). On success the answers clear and a NEW unapproved
version loads — the approval gate re-engages.

### The flat brief library + regen contract (stage 4 entry)

Top-nav "Client brief" → `/brief` renders the flat, filterable library
(`brief-picker.spec.ts` is its acceptance test):

- `brief-entry-list` holds `brief-entry` rows
  (`data-analysis-id` / `data-bill-id` / `data-client-id`) in chronological
  order (newest first — the server's `/briefs` order); `briefs-empty` shows
  when no briefs exist.
- Every row carries **exactly one** of `brief-tag-approved` ("Approved") |
  `brief-tag-review` ("Needs review"), plus an optional band chip when the
  pair was scanned.
- `brief-filter-bill` and `brief-filter-client` are native `<select>`s
  (option value = the id, `""` = all) that **AND-combine**; resetting both
  restores the full list. Clicking a row opens the pair's brief page at
  `/clients/:clientId/bills/:billId`.
- **Removed** with the drill-down (must not render): `brief-bill-list`,
  `brief-bill-card`, `brief-client-list`, `brief-client-card`, `brief-back`.

On the brief page, the regen panel: `regen-toggle` (collapsed "Regenerate with
feedback…" affordance) reveals `regen-context-input` (textarea) +
`regen-brief`; on success the brief re-renders and the panel collapses
(`regen-context-input` hidden again).
