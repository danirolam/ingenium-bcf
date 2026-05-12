# Injenium — AI-Native Legal Intelligence for Canadian Law Firms

> Internal AI tooling that turns the firehose of federal legislative activity into client-specific legal advice in minutes instead of weeks.

Injenium is a full-stack web application that automates one of the most tedious — and highest-stakes — workflows in a corporate law practice: tracking proposed federal legislation, surfacing the exact statutory changes each bill would introduce, and translating those changes into concrete, billable advice for individual clients.

Built end-to-end by a small team during an AI × Law hackathon, the project demonstrates a complete production-grade slice of modern legal-tech: data acquisition from public government APIs, a normalization pipeline, an LLM-powered diff engine, a React front-end modeled on tools lawyers already trust (Git, CanLII), and a human-in-the-loop client-impact analyzer that drafts ready-to-send client emails.

---

## Table of Contents

1. [Why this exists](#why-this-exists)
2. [The pipeline at a glance](#the-pipeline-at-a-glance)
3. [Product walkthrough](#product-walkthrough)
4. [Architecture](#architecture)
5. [Tech stack](#tech-stack)
6. [Data pipeline](#data-pipeline)
7. [AI / LLM design](#ai--llm-design)
8. [Human-in-the-loop & safety](#human-in-the-loop--safety)
9. [Repository layout](#repository-layout)
10. [Local development](#local-development)
11. [What this project demonstrates](#what-this-project-demonstrates)

---

## Why this exists

When a federal bill is tabled in the Canadian Parliament, it rarely arrives as plain prose. It is a structured set of *amendments* to one or more existing statutes — "delete the comma in section 5(1)(b)", "replace paragraph 12 with the following", and so on. To understand what a bill actually does, a lawyer has to:

1. Find the bill on the LEGISinfo portal,
2. Pull the official XML of the bill,
3. Pull the **current** version of every statute the bill touches from the Justice Laws site,
4. Mentally apply each amendment to reconstruct the future state of the law,
5. Decide whether that future state matters to any of the firm's clients,
6. Write a personalized memo or email to each affected client.

This burns hours per bill, multiplied across hundreds of bills per session, multiplied across every client a firm represents. Most of it never gets done — clients are simply not told until a law is already in force.

Injenium collapses that workflow into a three-click pipeline backed by Gemini.

## The pipeline at a glance

```
┌────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ 1. Bill Monitor        │ →  │ 2. Delta Workspace       │ →  │ 3. Client-Law Scanner    │
│                        │    │                          │    │      ↓                   │
│ Auto-ingested federal  │    │ AI-extracted, CanLII-    │    │ 4. Client Impact         │
│ bills with relevance   │    │ style diff between       │    │    Analysis              │
│ scoring                │    │ current law and bill     │    │                          │
│                        │    │                          │    │ Per-client risk memo +   │
│                        │    │ Human approval gate →    │    │ drafted email, gated by  │
│                        │    │ feeds Phase 2            │    │ lawyer review            │
└────────────────────────┘    └──────────────────────────┘    └──────────────────────────┘
        Phase 1: Legislative monitoring                 Phase 2: Client value
```

Three steps, two human gates, one fully automated background pipeline. The system is opinionated about *where the lawyer must stay in the loop* — every Gemini output is presented as a draft to be reviewed, never a final action.

## Product walkthrough

### 1. Bill Monitor — automated legislative intake

The landing page is a relevance-ranked inbox of every bill currently before the 45th Parliament, 1st Session. Bills are ingested from the official LEGISinfo JSON feed, normalized into the application's schema, and scored by likely client relevance against the firm's practice areas. New bills can also be uploaded manually for ad-hoc analysis.

For each bill the lawyer sees:

- LEGISinfo metadata (sponsor, status, latest activity date, parliamentary stage)
- Linked acts — the existing statutes the bill amends
- A status badge (`Pending` → `Approved` → `Client-Matched`) that tracks where the bill is in the firm's internal workflow

### 2. Delta Workspace — the Git-for-laws view

Selecting a bill opens the Delta Workspace, the technically deepest part of the product. This is where Gemini does the heavy lifting.

For each statute the bill touches, Injenium produces a **CanLII-style side-by-side diff** of the current legal text against the projected post-amendment text:

- Left pane: the current law, pulled directly from the official Justice Laws XML.
- Right pane: the same law as it would read if the bill passed, reconstructed by applying each amendment instruction in the bill's XML.
- Granular section-level expand/collapse controls, line-level red/green diff highlighting, and per-section summaries explaining *why* each change matters.

What normally takes a junior associate hours of cross-referencing collapses into a single, scannable view that mirrors tools (Git, CanLII) lawyers already trust. The lawyer can approve the extracted delta, which promotes it to the firm's internal "law versions" store and unlocks Phase 2.

### 3. Client-Law Scanner — pairing bills to client books

Once a delta is approved, it becomes a candidate for client impact analysis. The Client-Law Scanner is a two-pane workspace:

- One side lists every approved future-law candidate.
- The other lists every client in the firm's book, with structured profiles (industry, jurisdictions, regulated activities, material contracts, prior advisories).
- New clients can be added via a structured form; existing clients are searchable and re-usable across analyses.

The lawyer pairs a bill with a client and clicks **Analyze impact**.

### 4. Client Impact Analysis — drafted advice, human-gated

This is where Injenium delivers its core value. Gemini receives:

- The structured client profile,
- The approved bill delta (current vs. proposed law, in both raw XML and Injenium's normalized form),
- The bill's metadata, sponsor signal, and status.

It returns a strongly-typed JSON document containing:

- **Urgency rating** with reasoning,
- **Specific impact areas** — which client operations, contracts, or licences are affected, and how,
- **Recommended adaptations** — concrete steps the client should take, ordered by priority,
- **Lawyer-review questions** — issues the AI explicitly flags for human judgment rather than answering itself,
- **A drafted email to the client** — subject line, greeting, body, and call-to-action, written in the firm's voice.

The lawyer reviews, edits, and either sends the email (via Resend) or discards. Long-running Gemini calls trigger backend email notifications so the lawyer can step away and come back when the analysis is ready.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      React + Vite + TypeScript                   │
│                                                                  │
│  Bill Monitor  →  Delta Workspace  →  Scanner  →  Impact View    │
│                                                                  │
│       ▲                                                          │
│       │  /api/*  (proxied by Vite dev server → :8787)            │
│       ▼                                                          │
├──────────────────────────────────────────────────────────────────┤
│                  Express + TypeScript API (:8787)                │
│                                                                  │
│   Routes:  bills · lawVersions · clients · clientImpact          │
│                                                                  │
│   Services:                                                      │
│     · gemini          — typed prompt wrappers, JSON-mode calls   │
│     · billNormalizer  — XML → normalized JSON                    │
│     · seedSource      — cold-start ingest from data/             │
│     · jsonStore       — durable file-backed state                │
│     · email           — Resend integration + simulation fallback │
│     · humanReview     — approval gates & status transitions      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                       Data acquisition layer                     │
│                                                                  │
│   scripts/retrieve-bill-texts.mjs    LEGISinfo XML downloader    │
│   scripts/retrieve-law.mjs           Justice Laws downloader     │
│   scripts/build-master-registry.mjs  Law slug registry builder   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                        Persistent data                           │
│                                                                  │
│   data/raw/legisinfo/      — upstream LEGISinfo JSON feed        │
│   data/normalized/         — normalized + relevance-ranked bills │
│   data/bills/45-1/         — per-bill official XML + JSON        │
│   data/laws/current/       — current statute baselines           │
│   data/laws/registry.json  — law slug → official source URLs     │
│   data/clients/demo/       — demo client profiles                │
│   server/data/             — runtime state (versions, statuses)  │
└──────────────────────────────────────────────────────────────────┘
```

The split is deliberate: anything that comes from the Government of Canada (bills, laws) lives under `data/` and is regenerable from upstream sources via the scripts. Anything that represents the firm's internal state (approvals, AI-extracted deltas, client roster) lives under `server/data/` and is mutable at runtime.

## Tech stack

**Frontend**
- React 18 with TypeScript
- Vite for the dev server and build
- Tailwind CSS for styling
- Custom CanLII-style diff renderer (built on top of the `diff` package) with section-aware expand/collapse
- Zero UI framework dependency — every component (sidebar, badges, confidence meter, toast, diff viewer) is hand-built for the use case

**Backend**
- Node.js + Express in TypeScript, run through `tsx` for hot reload
- `concurrently` orchestrates the web and API processes in development
- File-backed JSON persistence (`server/data/*.json`) — chosen deliberately to keep the demo zero-infrastructure and the data inspectable, while leaving room to swap in a real database behind the `jsonStore` service

**AI**
- Google Gemini (`gemini-2.5-flash`) via the official `@google/generative-ai` SDK
- Strict `responseMimeType: "application/json"` mode for every call, paired with hand-authored TypeScript types on the response — every AI output is validated against the schema before it reaches the UI

**Email**
- Resend SDK with a simulation fallback so the app remains fully demo-able without credentials

**Data**
- Official LEGISinfo JSON feed for bill metadata
- Official Justice Laws XML for current statute text
- Custom normalization pipeline (`server/services/billNormalizer.ts`, `scripts/`) that converts XML into a structured JSON representation suitable for both display and prompting

## Data pipeline

The data layer is the unsung hero of the project. Producing a useful AI diff requires that *both* sides of the diff be clean, structured, and addressable at the section level — something the raw government XML is not.

The pipeline is:

1. **Bill ingest** — `data/raw/legisinfo/45-1/bills.json` is fetched directly from `parl.ca/legisinfo`. A normalization step scores each bill for client relevance and emits a sorted feed.
2. **Bill text retrieval** — `scripts/retrieve-bill-texts.mjs` walks the recommended bills and pulls their official XML, then normalizes each into the schema consumed by the app.
3. **Current-law retrieval** — `scripts/retrieve-law.mjs <slug>` reads `data/laws/registry.json` to learn the official Justice Laws XML URL for a statute, downloads it, and writes both the raw XML and a normalized JSON form into `data/laws/current/federal/<slug>/`.
4. **Bill ↔ law linkage** — `data/laws/bill-law-links.45-1.json` records which bills amend which registered statutes; this is what makes section-aligned diffing possible.
5. **Cold-start seed** — on boot, the server's `seedSource` service loads all of the above into the runtime store, so the very first request to the UI returns real data instead of an empty page.

Every step is idempotent and regenerable. Pulling fresh upstream data is a single command.

## AI / LLM design

The hardest engineering problem in the project is not "call Gemini and render markdown". It is producing AI output that is **structured, typed, auditable, and grounded in the actual legal text**. The design hits all four:

- **JSON-mode end-to-end.** Every prompt instructs Gemini to return JSON conforming to a documented shape, with `responseMimeType: "application/json"` enforced at the SDK level. The server validates against the matching TypeScript type before storing or rendering.
- **Grounded prompts, not free-form.** The delta-extraction prompt sees the bill's amendment XML *and* the current law's normalized JSON. The client-impact prompt sees the approved delta *and* a structured client profile. Gemini is never asked to recall law from memory — it is asked to reason over text provided in the prompt.
- **Strongly-typed contracts.** The frontend, backend, and Gemini call all share the same `LawVersion`, `ClientImpactAnalysis`, and related types from `src/types.ts`. A change to the schema is a compile error, not a runtime surprise.
- **Graceful degradation.** When Gemini quota is exhausted or a JSON parse fails, the server logs the failure and returns a 503 with a human-readable hint, rather than silently rendering broken output. The UI surfaces this state explicitly.

## Human-in-the-loop & safety

Injenium is built around the assumption that **a lawyer's judgment is the product** and AI is a force multiplier, not a replacement. Concretely:

- Every bill must be explicitly **approved** in the Delta Workspace before it becomes eligible for client matching. Approval is a deliberate UI action; bills do not flow into client analysis silently.
- Every client email is presented as a **draft**, with the AI's reasoning, recommended actions, and review questions shown alongside. Send is a separate action.
- Gemini is prompted to **flag its own uncertainty**: every analysis includes a `lawyer-review questions` field where the model lists issues it considers out-of-scope for itself.
- **Long-running operations trigger lawyer notifications** (via Resend or simulation), so a lawyer can kick off an analysis, leave it, and be pulled back in when there is something for them to review.
- The data store is **inspectable by design** — flat JSON files, readable on disk, so a firm could audit exactly what was extracted and what was sent.

## Repository layout

```
project-injenium/
├── src/                            React frontend
│   ├── App.tsx                     Top-level router
│   ├── main.tsx                    Vite entry
│   ├── types.ts                    Shared TS types (bills, laws, clients, AI outputs)
│   ├── pages/
│   │   ├── BillMonitor.tsx         Phase 1 — relevance-ranked bill inbox
│   │   ├── DeltaWorkspace.tsx      Phase 1 — Gemini-powered law diff
│   │   ├── ClientLawScanner.tsx    Phase 2 — bill × client pairing
│   │   └── ClientImpactAnalysis.tsx Phase 2 — drafted client memo + email
│   ├── components/
│   │   ├── DiffViewer.tsx          Section-aware CanLII-style diff renderer
│   │   ├── ConfidenceMeter.tsx     Visualizes AI confidence per finding
│   │   ├── Sidebar.tsx, Layout.tsx, PageHeader.tsx
│   │   ├── ClientSelector.tsx, Toast.tsx, badges.tsx
│   └── lib/                        Frontend helpers
│
├── server/                         Express + TypeScript API
│   ├── index.ts                    HTTP server bootstrap
│   ├── routes/
│   │   ├── bills.ts                Bill list, detail, delta-extract endpoints
│   │   ├── lawVersions.ts          Approved law-version store
│   │   ├── clients.ts              Client CRUD
│   │   └── clientImpact.ts         Run-impact-analysis & email-draft endpoints
│   ├── services/
│   │   ├── gemini.ts               Typed wrappers around the Gemini SDK
│   │   ├── billNormalizer.ts       XML → normalized JSON
│   │   ├── seedSource.ts           Cold-start ingest from data/
│   │   ├── jsonStore.ts            Durable file-backed key/value store
│   │   ├── email.ts                Resend + simulation fallback
│   │   └── humanReview.ts          Approval gates & status transitions
│   └── data/                       Runtime mutable state (JSON)
│
├── scripts/                        Data acquisition (run on demand)
│   ├── retrieve-bill-texts.mjs     Pull official bill XML from parl.ca
│   ├── retrieve-law.mjs            Pull official statute XML from Justice Laws
│   └── build-master-registry.mjs   Build the slug → source URL registry
│
├── data/                           Immutable / regenerable upstream data
│   ├── raw/legisinfo/45-1/bills.json
│   ├── normalized/bills.45-1.json
│   ├── normalized/recommended-bills.45-1.json
│   ├── bills/45-1/<bill>/          Per-bill source XML + normalized JSON
│   ├── laws/registry.json          Law slug → official URLs
│   ├── laws/bill-law-links.45-1.json
│   ├── laws/current/federal/<slug>/{current.xml, current.normalized.json}
│   └── clients/demo/               Demo client profiles
│
├── docs/                           Internal design notes
├── SETUP.md                        End-to-end setup, key acquisition, troubleshooting
├── tailwind.config.ts, postcss.config.js, vite.config.ts, tsconfig.json
└── package.json
```

## Local development

```bash
git clone <this-repo>
cd project-injenium
npm install
cp .env.example .env       # add GEMINI_API_KEY (+ optional RESEND_API_KEY)
npm run dev                # web on :5173, api on :8787 — vite proxies /api → 8787
```

Then open `http://localhost:5173`.

Full instructions — including how to acquire each API key, what works without keys, how to refresh upstream government data, and how to register additional statutes for analysis — live in **[SETUP.md](./SETUP.md)**.

> **Note:** This repository is the source code as shipped at the end of the hackathon. The live demo is not currently hosted because the team no longer has active Gemini API credentials; running locally with your own free-tier Gemini key reproduces every feature end-to-end.

## What this project demonstrates

For anyone evaluating this repository as a portfolio piece, the work here exercises:

- **Full-stack TypeScript** — typed all the way from the React component props down to the Gemini response shape, with one shared `types.ts` source of truth.
- **Real-world data engineering** — fetching and normalizing official XML from two different Government of Canada systems, with idempotent scripts and a documented refresh procedure.
- **Production-shaped LLM integration** — JSON-mode prompts, schema-validated responses, graceful degradation on quota / parse failures, and prompts that are *grounded* in supplied text rather than relying on model recall.
- **Domain-driven UX design** — building an interface that borrows visual idioms practising lawyers already know (Git diffs, CanLII section views) so adoption cost is near-zero.
- **Human-in-the-loop product thinking** — explicit approval gates, drafted-not-sent outputs, lawyer-review questions surfaced by the model, and notification flows for long-running tasks.
- **Pragmatic infrastructure choices** — file-backed JSON persistence and a Vite-proxied Express API keep the demo zero-ops while leaving every service boundary clean enough to swap in Postgres, a queue, or a managed inference endpoint without restructuring the app.
- **End-to-end ownership** — from upstream data acquisition scripts, to backend services, to UI components, to deployment-grade setup documentation.

Built for the AI × Law Hackathon. Designed to keep going.
