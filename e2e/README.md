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
| `api.spec.ts` | scan-ready list/detail/404, scorer (`/scan` + `/scans`: bands, determinism, no-score-leak, cascade), analyze 400/404, keyless analyze + by-pair, brief library (`/briefs` index: latestAt-desc sort, band join, no-score-leak; `guidance` on `/analyze`), client CRUD + cascade | **yes** (brief-library backend landed, a1f3f13) | — |
| `core-unit.spec.ts` | `clientScanCore.ts` pure functions incl. `bandFromScore`/`normalizeScore`/`heuristicScore` laws (a missing/broken module FAILS the suite) | **yes** (scorer backend landed) | — |
| `scan-ready.spec.ts` | ready list / approved summary UI | **yes** | — |
| `brief-picker.spec.ts` | stage-4 picker (`/brief`): bill → client drill-down to the brief page, `brief-back`, regen-with-guidance panel | not yet | brief-library frontend (in flight) |
| `scan-flow.spec.ts` | two-phase flow: band scoreboard → rationale accordion → single-action-slot analyze (slot swaps to view-brief) → brief → persistence | not yet | single-slot frontend (in flight) |
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

`GET /api/client-impact/briefs` is the brief-library index behind the `/brief`
picker: bills with ≥1 brief sorted `latestAt` desc, each with its
latest-per-pair briefed clients (band joined from the scans store iff the pair
was scanned — never the numeric score). `POST /analyze` also accepts an
optional **transient** `guidance` string (≤2000 chars — the regen panel's
counsel instructions, never persisted on the analysis); keyless servers still
answer 200 via the fallback.

Two behavioral notes encoded in the specs:

- `client-checkbox` is the checkable element itself (`<input type="checkbox">`
  or `[role="checkbox"]`) — the helpers drive it with `setChecked`.
- `select-all-clients` toggles between all-selected and none-selected; the
  specs settle exact state checkbox-by-checkbox afterwards, so either initial
  selection state is fine.

Stage-4 (Client Brief) selectors are derived from the page as it ships today
(`src/pages/ClientImpactAnalysis.tsx`): the `Client Brief — …` `h1`, the
`Summary` card, the `Needs review` badge and the `Lawyer review` /
`Review before sending` section.

### The brief-library picker + regen contract (stage 4 entry)

Top-nav "Client brief" → `/brief` renders the two-step picker
(`brief-picker.spec.ts` is its acceptance test):

- step 1: `brief-bill-list` of `brief-bill-card[data-bill-id]` cards, or the
  `briefs-empty` empty state when no briefs exist;
- step 2 (in-page, after clicking a bill card): `brief-back`,
  `brief-client-list`, `brief-client-card[data-client-id]` (shows a band chip
  when the pair was scanned); clicking a client card opens the existing brief
  page at `/clients/:clientId/bills/:billId`.

On the brief page, the regen panel: `regen-toggle` (collapsed "Regenerate with
instructions…" affordance) reveals `regen-context-input` (textarea) +
`regen-brief`; on success the brief re-renders and the panel collapses
(`regen-context-input` hidden again).
