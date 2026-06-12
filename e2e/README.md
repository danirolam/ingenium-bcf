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
| `api.spec.ts` | scan-ready list/detail/404, analyze 400/404, keyless analyze + by-pair, client CRUD + cascade | **yes** (Phase 1A backend landed) | — |
| `core-unit.spec.ts` | `clientScanCore.ts` pure functions (a missing/broken module FAILS the suite) | **yes** (Phase 1A backend landed) | — |
| `scan-ready.spec.ts` | ready list / approved summary UI | **yes** (Phase 2C frontend landed) | — |
| `scan-flow.spec.ts` | scan happy path → brief → back | **yes** (Phase 2C frontend landed) | — |
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
`scan-status` with exact text `queued|running|done|failed`, `view-brief`).

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
