# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ingenium (a.k.a. "injenium") is a legislative-intelligence app for BCF. It follows Canadian
federal bills through Parliament, extracts the exact statutory change a bill makes, matches
that change against a client's operations, and produces a counsel-reviewed exposure memo.
Live at https://ingenium-bcf.vercel.app.

The product is a single continuous four-stage workflow: **Monitor → Legal delta → Client scan → Client brief**.

## Commands

Requires Node 20+.

```bash
npm run dev              # web (vite) on :5173 + API (tsx watch) on :8787, concurrently
npm run server           # API only
npm run build            # vite production build into dist/
npm run preview          # serve the production build
npm run verify:gemini    # smoke-test the Gemini key (pass/fail), runs with --use-system-ca
```

There is **no test runner and no lint script** configured. Type-checking is via `tsc`
(`tsconfig.json`, `noEmit`); the build also surfaces type errors.

In dev, Vite proxies `/api` → `http://localhost:8787` (see `vite.config.ts`), so the SPA
talks to the local Express server transparently.

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

A Vite + React 18 + TypeScript SPA on top of an Express API. **No database** — the entire
state is a committed JSON snapshot.

### Frontend (`src/`)

- **Routing is hand-rolled, not react-router.** `App.tsx` holds `surface` ("landing" | "app")
  and `page` (a `PageId` union) in `useState`, switching components manually. A `Nav` object
  (`go`, `page`, `params`, `toast`) is threaded into every page as a prop — this is how pages
  navigate and pass parameters. Only deep-link supported is `#/app`.
- **The four workflow stages are defined once** in `src/lib/workflow.ts` (`WORKFLOW_STEPS`).
  The nav rail, tooltips, and help guide all read from it — change stage copy there, not in
  the components.
- `src/lib/api.ts` is the typed client for every `/api/*` endpoint; `src/types.ts` holds the
  shared domain types (`Bill`, `Client`, `LawVersion`, `ClientImpactAnalysis`).
- Pages: `BillMonitor`, `BillDetail`, `DeltaWorkspace`, `ClientLawScanner`,
  `ClientImpactAnalysis`, `Overview`, `Landing`.
- Styling is a custom CSS design system (`src/styles/injenium.css` + per-area CSS files) with
  a Tailwind layer on top. `@` is aliased to `src/`.
- Several derivations live in `src/lib/` and are also used by the build scripts:
  `legislativePath.ts` (`parseBillDetail`, `sponsorFrom`), `practiceAreas.ts`
  (`derivePracticeAreas`, deterministic keyword classifier).

### Backend (`server/`)

- `server/app.ts` (`createApp`) is the shared factory: loads `.env` by hand (no dotenv dep),
  runs `seedDemo()` once, mounts routers, and exposes `GET /api/health` (reports
  `ai.enabled` / `email.enabled`). It is used by both entry points:
  - `server/index.ts` — local dev server (listens on `PORT`, default 8787).
  - `api/index.ts` — Vercel serverless entry (production).
- Routes: `/api/bills` (incl. `POST /:id/extract-delta`, `POST /upload`),
  `/api/law-versions` (incl. `approve`, `needs-review`, `delete`), `/api/clients`,
  `/api/client-impact` (incl. `POST /analyze`, `email-lawyer`).
- **Data layer is `server/services/jsonStore.ts`** — CRUD over flat JSON files
  (`bills.json`, `lawVersions.json`, `clients.json`, `clientImpactAnalyses.json`,
  `baseLaws.json`). Locally it reads/writes `server/data/`. On Vercel the bundle is
  read-only except `/tmp`, so the runtime store is `/tmp/ingenium-data`, hydrated from the
  committed snapshot on cold start via `hydrateFromSnapshot()` (called by `seedDemo`). This
  is why production needs no DB, seed step, or keys at request time.

### AI is optional and isolated (`server/services/gemini.ts`)

The app is fully functional with **no key** — every screen has a deterministic fallback.
Gemini is called in exactly three synthesis spots, each returning `null` on any failure
(missing/invalid key, quota, malformed JSON) so the route falls back gracefully:

| Function | Used by | Fallback without key |
| --- | --- | --- |
| `analyzeClientImpact` | `routes/clientImpact.ts` | deterministic synthesized memo |
| `extractAmendmentsFromBill` | `routes/bills.ts` | one-sided "proposed text" stub + Justice Laws link |
| `generateUpdatedLawText` | (diff "after" side) | same stub |

Default model `gemini-2.5-flash` (override with `GEMINI_MODEL`); strict JSON enforced.
Two-sided legal diffs only work for Acts registered in `data/laws/registry.json` (5 today).
Everything else (ingestion, legislative path, practice-area tagging, client matching, diff
rendering) is deterministic and never calls a model. Email (`server/services/email.ts`,
Resend) follows the same optional pattern. See `AI_INTEGRATION.md` for the full handoff guide.

## Conventions / gotchas

- **ESM throughout** (`"type": "module"`). Server imports use `.js` extensions even for
  `.ts` source files (e.g. `import { createApp } from "./app.js"`) — this is required for
  the tsx/ESM resolution; keep the pattern when adding modules.
- Bills are keyed by a stable `id` that is **never changed** by the pipeline, and curated
  demo bills are preserved across refreshes. The snapshot holds ~5,694 bills across 16
  sessions (45-1 is current); ~160 carry full clause text, the rest are index records.
- Deploy to Vercel from the repo root: `npx vercel deploy --prod --yes`. `vercel.json`
  rewrites `/api/(.*)` → `/api/index` and bundles `{data,server/data}/**` into the function.
- Coarse `legislativeMomentum` buckets (`early → active → advanced → passed → in_force`) are
  computed by `mapMomentum()` in `server/services/billNormalizer.ts`.
