# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ingenium (a.k.a. "injenium") is a legislative-intelligence app for BCF. It follows Canadian
federal bills through Parliament, extracts the exact statutory change a bill makes, matches
that change against a client's operations, and produces a counsel-reviewed exposure memo.
Live at https://ingenium-bcf.vercel.app.

The product is a single continuous four-stage workflow: **Monitor → Legal delta → Client scan → Client brief**
(stage definitions live once in `src/lib/workflow.ts`; the nav rail/tooltips/help read from it).

## Commands

Requires Node 20+ (Node 24 features like `AbortSignal.any` are used server-side).

```bash
npm run dev              # web (vite) on :5173 + API (tsx watch) on :8787, concurrently
npm run server           # API only (respects PORT)
npm run build            # vite production build into dist/
npx tsc --noEmit         # typecheck (run from the REPO ROOT — e2e/ has its own tsconfig)
npm run verify:gemini    # smoke-test the Gemini key, runs with --use-system-ca
```

### Tests (Playwright, isolated `e2e/` package)

```bash
cd e2e && npm install && npx playwright install chromium   # once
npx playwright test          # full suite — ports 5173/8787 MUST be free (it boots its own dev stack)
npx playwright test --list   # discover specs without running
npx playwright test tests/smoke.spec.ts   # always-green proof-of-life
npm run test:live            # @live spec against YOUR running keyed server (RUN_LIVE=1)
npm run seed:demo            # (re)create the C-265 demo fixture — see below
```

The suite blanks `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`RESEND_API_KEY` in its managed server
(`server/app.ts`'s `loadEnv()` does NOT override already-set env vars — empty string blocks the
`.env` value and is falsy at call sites), so every assertion rides the deterministic keyless
fallbacks. `e2e/README.md` is the authoritative contract doc: the `data-testid` contract the
frontend implements, the endpoint shapes, and what global setup seeds/cleans (`__e2eSeed`
records, surgically removed by teardown).

### Data refresh pipeline

Run in order, then commit the updated `server/data/bills.json`. The network scripts **must**
use `node --use-system-ca` (parl.ca / OpenParliament TLS chains aren't in Node's bundled CA set):

```bash
node --use-system-ca scripts/fetch-bill-metadata.mjs    # 1. current-session detail → data/bills/45-1/
node --use-system-ca scripts/fetch-bill-texts.mjs       # 2. clause text from DocumentViewer XML
node --use-system-ca scripts/fetch-all-sessions.mjs     # 3. cross-session index (OpenParliament)
node --use-system-ca scripts/fetch-sessions-detail.mjs  # 4. sponsor/status per session (LEGISinfo bulk)
npx tsx scripts/build-bills-snapshot.ts                 # 5. bake current session into snapshot
npx tsx scripts/merge-all-sessions.ts                   # 6. merge lightweight cross-session records
npx tsx scripts/enrich-bills.ts                         # 7. overlay real sponsor/status/momentum
```

To add a registered Act for two-sided diffs: register it in `data/laws/registry.json`, then
`node --use-system-ca scripts/retrieve-law.mjs <law-slug>`, then restart the server.

## Architecture

A Vite + React 18 + TypeScript SPA on top of an Express API. **No database** — flat JSON files.

### Frontend (`src/`)

- **Routing is hand-rolled, not react-router.** `src/lib/routes.ts` maps real paths
  (`/bills`, `/bills/:id`, `/delta`, `/clients`, `/clients/:clientId/bills/:billId`, `/brief`)
  to a `PageId`; `App.tsx` threads a `Nav` object (`go`, `page`, `params`, `toast`) into every
  page as a prop — that is how pages navigate and pass parameters.
- `src/lib/api.ts` is the typed client for the long-standing endpoints; **stage-3/4 additions
  live in `src/lib/clientScan.ts`** (scan-ready, scan/scans, briefs index, analyze-with-guidance)
  with wire types mirrored from the server by sync-comments. `src/types.ts` holds the shared
  domain types (`Bill`, `Client`, `ProvisionDelta`, `ClientImpactAnalysis`).
- Styling is a custom CSS design system (`src/styles/injenium.css` + page-scoped files —
  `clientscan.css`, `briefpicker.css`); page CSS is imported only by its page/component.

### Backend (`server/`)

- `server/app.ts` (`createApp`) is the shared factory (hand-rolled `.env` loader, `seedDemo()`,
  routers, `GET /api/health`), used by `server/index.ts` (local) and `api/index.ts` (Vercel).
- **Data layer is `server/services/jsonStore.ts`** — CRUD over flat JSON files. Locally it
  reads/writes `server/data/`; on Vercel the runtime store is `/tmp/ingenium-data`, hydrated
  from the committed snapshot on cold start. Only `bills.json`, `clients.json` and
  `lawVersions.json` are tracked in git; everything else under `server/data/` is **gitignored
  runtime state** (`provisionDeltas.json`, `approvals.json`, `clientImpactAnalyses.json`,
  `clientScans.json`) — absent on fresh checkouts until stage 2 runs or a seeder writes them.

### The pipeline's data flow (the part that needs multiple files to understand)

1. **Stage 2 (Legal delta)** — `POST /api/bills/:id/provision-delta` (`server/routes/bills.ts`)
   computes per-Act provision diffs: deterministic bill-XML parsing where possible, otherwise
   an **agentic Claude interpreter** (`server/services/claude.ts`, tool-use loop that looks up
   real Act provisions) plus an AI "scalpel" for partial edits. Results cache in
   `provisionDeltas.json`; counsel approvals (`approvals.json`, keys `"<actSlug>#<opIndex>"`)
   gate everything downstream. `server/services/aiBudget.ts` is a shared abort/circuit-breaker
   for rate limits.
2. **Stage 3 (Client scan)** — bill-first UI (`ClientLawScanner.tsx`): `GET /api/client-impact/scan-ready`
   lists bills with approved ops; per selected client, `POST /scan` runs the **scorer agent**
   (forced `emit_impact_score` tool, ~600 output tokens) producing an impact **band**
   (low/medium/high/critical). **The numeric 0–100 score never leaves the backend** — it is
   stored in `clientScans.json` (latest-wins, id `scan-<client>-<bill>`) purely to rank rows and
   is stripped by an allowlist in the route; e2e enforces the no-leak contract. Each scored row
   has a single action slot: Analyze → View brief (no re-analysis from stage 3).
3. **Stage 4 (Client brief)** — `POST /analyze` runs the **brief agent**
   (`analyzeClientFromChanges`: deterministic triage → chunked map-reduce ≤6×25k-token chunks →
   merge, with coverage accounting that NAMES any unanalyzed ops in the brief). Briefs persist
   in `clientImpactAnalyses.json` (pruned to 3 per pair). `GET /briefs` powers the `/brief`
   drill-down library (`src/components/BriefPicker.tsx`). Regeneration hands the agent the pair's
   **previous brief** (revise-not-restart) plus optional transient `guidance` — the reviewing
   lawyer's instructions/feedback channel, never persisted.
4. **Pure vs IO split**: all scan/brief pure logic (triage, chunking, merging, normalizers,
   `bandFromScore`, `heuristicScore`, `serializePriorBrief`) lives in
   `server/services/clientScanCore.ts` — dependency-free and unit-tested directly by
   `e2e/tests/core-unit.spec.ts`. IO/orchestration lives in `server/services/clientScan.ts`.

### AI integration

The app is fully functional with **no keys** — every AI call has a deterministic fallback
(synthesized memo, `heuristicScore`, canned demo impacts), which CI depends on.

- **Anthropic is the primary provider** (raw `fetch` to the Messages API, no SDK; model
  `ANTHROPIC_MODEL` || `claude-haiku-4-5`, temperature 0, forced tool-use for structured
  output, `cache_control` on stable system/tool prefixes). Used by: stage-2 interpretation
  (`claude.ts`, `scalpel.ts`), the stage-3 scorer and the stage-4 brief agent (`clientScan.ts`).
  Any failure (429/timeout/truncation) trips the shared `AiBudget` where appropriate and falls
  back — labeled honestly ("Heuristic (no AI key)" vs "(AI unavailable)").
- **Gemini** (`server/services/gemini.ts`, `GEMINI_API_KEY`) remains for the legacy
  full-text delta path (`extract-delta`) and as the keyless-Anthropic fallback interpreter.
- Email (`server/services/email.ts`, Resend) is optional; without a key it reports
  `simulated: true`.

## Conventions / gotchas

- **ESM throughout** (`"type": "module"`). Server imports use `.js` extensions even for `.ts`
  source files (`import { createApp } from "./app.js"`) — required for tsx/ESM resolution.
- **Express 4 + async handlers**: a rejected async handler is an unhandled rejection that
  KILLS the process (tsx watch does not respawn). Wrap every new route in `safe()` and read
  stores with the null-tolerant `findRecord()` (both exported from
  `server/services/clientScan.ts`) — a stored `null` array element is valid JSON and crashes
  `jsonStore.findById`.
- **Read-modify-write needs `withFileLock(file, fn)`** (same module): jsonStore serializes
  physical writes but not RMW sequences — concurrent upsert+prune clobber each other without it.
- Don't add entries to `FILES` in `jsonStore.ts` for stage-3/4 stores — pass literal filenames
  (see `SCANS_FILE`). Register specific routes (e.g. `/scan-ready`, `/briefs`) **before**
  `/:id` catch-alls. Under `safe()`, coerce params with `String(req.params.x)`
  (@types/express v5 widens them to `string | string[]`).
- **Stage ownership (merge safety)**: stages 1–2 (bills/delta machinery: `server/routes/bills.ts`,
  `server/services/{claude,gemini,scalpel,amendmentEngine,jsonStore,aiBudget}.ts`) are developed
  on `jim/delta`; stages 3–4 own `server/routes/{clientImpact,clients}.ts`, the clientScan
  services, and their pages. Cross-stage needs are met by new files and read-only store access,
  not edits to the other stage's modules. Broadly-shared files (`src/types.ts`, `src/lib/api.ts`,
  root `package.json`) change only with good reason — e2e keeps its own package/lockfile under
  `e2e/` for exactly this reason.
- **Demo fixture**: `cd e2e && npm run seed:demo` makes the real Bill C-265 scan-ready (six
  approved ops anchored to genuine Food and Drugs Act provisions) and upserts the two demo
  clients (Aurelia Therapeutics, Lakehead Regional Health Network). Its records carry
  `__demoSeed` and survive the test suite's teardown; only `?refresh=1` on the stage-2 delta
  endpoint would overwrite the cached delta. Demo clients are id-protected in the e2e teardown.
- Bills are keyed by a stable `id` that is **never changed** by the pipeline; the snapshot
  holds ~5,694 bills across 16 sessions (45-1 is current), ~160 with full clause text.
- Deploy to Vercel from the repo root: `npx vercel deploy --prod --yes`. `vercel.json`
  rewrites `/api/(.*)` → `/api/index` and bundles `{data,server/data}/**` into the function.
