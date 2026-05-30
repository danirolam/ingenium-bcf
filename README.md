# Ingenium

Legislative intelligence for BCF. Ingenium turns Canadian federal legislative change
into clear, client‑specific advice. It follows every federal bill through Parliament,
pinpoints the exact statutory change a bill makes, matches that change against a
client's operations, and produces a counsel‑reviewed exposure memo.

**Live:** https://project-injenium.vercel.app

The workspace is one continuous flow:

1. **Monitor** — browse every federal bill, by session, practice area, momentum, or search.
2. **Legal delta** — see exactly which sections of which Acts a bill adds, repeals, or replaces, side by side.
3. **Client scan** — match an approved change against a client's operations, contracts, and policies.
4. **Client brief** — generate a client‑specific exposure memo, ready for a lawyer to review and send.

---

## Tech stack

- **Frontend:** Vite + React 18 + TypeScript single‑page app (`src/`), with a small Tailwind layer on top of a custom CSS design system.
- **Backend:** Express API (`server/`), served as a Vercel serverless function in production (`api/index.ts`) and a local dev server (`server/index.ts`).
- **Data store:** committed JSON snapshot (`server/data/*.json`) — no database. In production it hydrates into the writable `/tmp` directory on cold start, so the app works online with **no setup step**.
- **Optional AI:** Google Gemini powers the live client‑impact memo and registered‑Act diff synthesis. Everything works without it (deterministic fallbacks); adding a key just upgrades those two steps.

---

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev      # web on http://localhost:5173, API on http://localhost:8787
```

Other scripts:

```bash
npm run build    # production build (Vite) into dist/
npm run preview  # serve the production build locally
npm run server   # run only the API (tsx watch)
```

---

## Configuration — where the API key goes

**The app runs fully without any keys.** Keys only enable the live AI synthesis steps;
without them, Ingenium falls back to deterministic, real‑looking output, so the only
remaining step to "turn on" AI is adding the key.

Copy the template and fill in what you want:

```bash
cp .env.example .env
```

| Variable | Required? | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Enables live client‑impact memos and the before/after diff for registered Acts. Without it, the app uses a deterministic synthesized analysis. Get a free key at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | Optional | Overrides the model (default `gemini-2.5-flash`). |
| `RESEND_API_KEY` | Optional | Sends the lawyer‑notification email for real. Without it, emails are simulated (logged, not sent). |
| `PORT` | Optional | API port (default `8787`). |

**Local:** put the key in `.env` (already git‑ignored).

**Production (Vercel):** add it under **Project → Settings → Environment Variables**
(`GEMINI_API_KEY`), then redeploy. Nothing else changes — the same code reads
`process.env.GEMINI_API_KEY`.

---

## How the data works

Ingenium runs entirely on **real Canadian federal legislative data**, harvested from
official Parliament of Canada sources and a community API, then baked into a single
committed snapshot that the app serves with no live dependency at request time. Nothing
is mocked — the bill text, sponsors, statuses, votes, and legislative paths all come
from the records below.

### Data sources

| Source | URL pattern | What it provides |
| --- | --- | --- |
| **LEGISinfo — per‑bill detail JSON** | `https://www.parl.ca/legisinfo/en/bill/{session}/{number}/json` | The rich record for one bill: House / Senate / Royal Assent stages, committees, sittings, recorded divisions, sponsor, status, publications, statute citation, summary. |
| **LEGISinfo — bulk per‑session JSON** | `https://www.parl.ca/legisinfo/en/bills/json?parlsession={session}` | One call returns every bill in a session with sponsor, current status, and latest activity — used to enrich thousands of older bills cheaply. |
| **parl.ca DocumentViewer → structured bill XML** | `https://www.parl.ca/DocumentViewer/en/{publicationId}` (embeds a link to `…_E.xml`) | The official structured XML of the bill, parsed into ordered clauses (the full clause‑by‑clause text). |
| **OpenParliament API** | `https://api.openparliament.ca/bills/?format=json` | A lightweight cross‑session index of every bill in Parliament's history, plus a flag for which became law. |

All fetchers send a descriptive user‑agent and retry with backoff. Because parl.ca and
OpenParliament serve over TLS chains Node's bundled CA set does not always trust, the
network scripts must run with **`node --use-system-ca`**.

### The pipeline, in order

Scripts live in `scripts/`. The first group writes intermediates under `data/`; the last
three fold everything into the committed snapshot at `server/data/bills.json`.

1. **`fetch-bill-metadata.mjs`** — fetches the LEGISinfo per‑bill detail JSON for the current session and caches it at `data/bills/45-1/{NUMBER}/metadata.json` (the authoritative source for the legislative path).
2. **`fetch-bill-texts.mjs`** — for each bill, opens its DocumentViewer page, extracts the structured‑XML link, downloads it, and parses it into ordered clauses (`bill.xml` + `bill.normalized.json`).
3. **`fetch-all-sessions.mjs`** — pages the OpenParliament `/bills/` endpoint for every bill across all 16 sessions and writes `data/all-sessions.json`.
4. **`fetch-sessions-detail.mjs`** — calls the LEGISinfo bulk per‑session JSON (one request per session) for real sponsor, precise status, and latest activity → `data/sessions-detail.json`.
5. **`build-bills-snapshot.ts`** — bakes legislative path, recorded divisions, sponsor, statute citation, summary, dates, status/momentum, and the full clause text into `server/data/bills.json` for the current session. Bill **ids are never changed** and curated demo bills are preserved.
6. **`merge-all-sessions.ts`** — folds `all-sessions.json` into the snapshot as lightweight records for every session/number not already present (status, source URL, practice‑area tags). The rich current‑session set is never overwritten.
7. **`enrich-bills.ts`** — overlays `sessions-detail.json` onto those cross‑session bills (real sponsor, precise status, momentum).

Result: `server/data/bills.json` holds **5,694 bills across 16 sessions** (45‑1 is the
current session). 160 carry full clause text and a parsed legislative path; the rest are
searchable index records with real sponsor / status / momentum.

### How each field is derived

- **Bill text / clauses** — from the official DocumentViewer XML: `<Section>` → clause number, marginal‑note heading, body text, and every `<XRefExternal reference-type="act">` as the Acts that clause amends.
- **Sponsor** — `sponsorFrom()` in `src/lib/legislativePath.ts` (name, honorific, role, constituency, party). Cross‑session bills get their sponsor from the bulk per‑session JSON.
- **Status & momentum** — `status` is LEGISinfo's status text; the coarse `legislativeMomentum` bucket (`early → active → advanced → passed → in_force`) is computed by `mapMomentum()` in `server/services/billNormalizer.ts`.
- **Legislative path** — `parseBillDetail()` in `src/lib/legislativePath.ts` normalizes the House, Senate, and Royal Assent stages into an ordered timeline (stage, state, date, committee, sittings, recorded divisions with yeas / nays / paired).
- **Practice‑area tags** — `derivePracticeAreas()` in `src/lib/practiceAreas.ts`, a deterministic keyword classifier (no model calls) mapping each bill to BCF practice groups.

### The committed snapshot and online hydration

`server/data/bills.json` (plus `clients.json`, `lawVersions.json`, `baseLaws.json`) is
committed to the repo — the complete curated state the app serves. `jsonStore.ts` reads
and writes `server/data/` locally, and `/tmp/ingenium-data` on Vercel (the only writable
path). On a cold start, `seedDemo()` calls `hydrateFromSnapshot()`, which copies the
committed snapshot into `/tmp`. **Production serves the identical 5,694‑bill state with no
seed/build step at request time, no database, and no keys required.**

### Refreshing the data

```bash
node --use-system-ca scripts/fetch-bill-metadata.mjs    # 1. current-session detail
node --use-system-ca scripts/fetch-bill-texts.mjs       # 2. full clause text (XML)
node --use-system-ca scripts/fetch-all-sessions.mjs     # 3. cross-session index
node --use-system-ca scripts/fetch-sessions-detail.mjs  # 4. sponsor/status per session
npx tsx scripts/build-bills-snapshot.ts                 # 5. bake into snapshot
npx tsx scripts/merge-all-sessions.ts                   # 6. merge cross-session records
npx tsx scripts/enrich-bills.ts                         # 7. enrich sponsor/status
```

Then commit the updated `server/data/bills.json`; the next deploy hydrates it
automatically. (The 45th Parliament, 1st session is the most recent — there is no newer
session to add.)

---

## Deployment

Production runs on Vercel as a serverless function. Deploy from the repo root:

```bash
npx vercel deploy --prod --yes
```

The build runs `npm run build`; the API is served from `api/index.ts`. To enable live AI,
set `GEMINI_API_KEY` in the Vercel project's Environment Variables first.

---

## Repository workflow (two repos)

There are two GitHub repositories:

- **`origin` → `danirolam/ingenium-bcf`** — **your** repository. This is where your work
  and your full commit history live, and it is the repository connected to Vercel.
- **`team` → `Lil-Chen05/project-injenium`** — the **shared team** repository (think of it
  as the upstream everyone collaborates through). It is not a different kind of object —
  it is just another GitHub repo; your repo relates to it the way a fork relates to its
  upstream.

The remotes are already configured:

```bash
git remote -v
# origin  https://github.com/danirolam/ingenium-bcf.git
# team    https://github.com/Lil-Chen05/project-injenium.git
```

### Day to day — work on your repo

```bash
git add -A
git commit -m "…"
git push origin main      # your history; this is what deploys
```

### Pull in what the team did on the shared repo

```bash
git fetch team
git merge team/main       # or: git rebase team/main
# resolve any conflicts, then
git push origin main
```

### Push your work up to the shared team repo

```bash
git push team main                      # if you have push access, or
git push team main:feature/your-change  # then open a Pull Request on the team repo
```

This keeps a clean separation: you always work and deploy from your own repo with your own
history, you can pull the team's progress in whenever you want, and you can hand work back
to the team without losing your independent timeline.

---

## Project structure

```
src/                 React SPA
  pages/             Monitor, BillDetail, DeltaWorkspace, ClientLawScanner, ClientImpactAnalysis, Overview, Landing
  components/        WorkflowNav, Tooltip, DiffViewer, badges, StatsRibbon, …
  lib/               legislativePath, practiceAreas, api, export, utils
  styles/            design system (injenium.css) + per-area CSS
server/              Express API
  routes/            bills (incl. extract-delta), clientImpact, …
  services/          jsonStore (hydration), gemini (optional), email, billNormalizer
  seed/              seedDemo (hydrateFromSnapshot on boot)
  data/              committed JSON snapshot (5,694 bills, clients, law versions)
scripts/             data-fetch + snapshot-build pipeline
api/index.ts         Vercel serverless entry
```
