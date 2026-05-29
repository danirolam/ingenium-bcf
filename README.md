# Ingenium

Project Ingenium is a federal bill monitoring and client impact prototype.

The project starts with LEGISinfo bill metadata in JSON, ranks bills by likely client relevance, retrieves official bill text XML, and keeps the data easy to refresh when new bills appear.

## App

The web app lives at the repo root: React + Vite + TypeScript frontend, Express + Gemini backend, four pages (Bill Monitor → Delta Workspace → Client-Law Scanner → Client Impact Analysis).

```bash
npm install
cp .env.example .env       # add GEMINI_API_KEY for live extraction; without it, the S-202 demo path still works
npm run dev                # web on :5173, api on :8787
```

See **[SETUP.md](./SETUP.md)** for API-key instructions, what works without keys, and how to refresh seed data.

## Current Data Files

```text
data/raw/legisinfo/45-1/bills.json
```

Raw LEGISinfo bill inbox for the 45th Parliament, 1st session.

```text
data/normalized/bills.45-1.json
```

Normalized bill list sorted by latest activity date.

```text
data/normalized/recommended-bills.45-1.json
```

High-priority bills scored for demo/client relevance.

```text
data/bills/45-1/
```

Official Parliament bill text for the recommended bills. Each bill folder contains source metadata, official XML, and normalized JSON for app/search/analysis use.

```text
data/laws/
```

Current law baselines from Justice Laws. The important files are:

```text
data/laws/registry.json
data/laws/bill-law-links.45-1.json
data/laws/current/federal/food-and-drugs-act/current.xml
data/laws/current/federal/food-and-drugs-act/current.normalized.json
```

`registry.json` explains how a law is retrieved. `bill-law-links.45-1.json` explains which bills currently point to which laws.

```text
data/clients/demo/
```

Three fake client profiles for demo impact analysis.

## Update Flow

When new bills show up:

1. Download the latest JSON from:

```text
https://www.parl.ca/legisinfo/en/bills/json?parlsession=45-1
```

2. Replace:

```text
data/raw/legisinfo/45-1/bills.json
```

3. Regenerate the normalized/recommended JSON using the same scoring rules described in `data/README.md`.

4. Retrieve the actual text for the recommended bills:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs
```

5. Refresh a current law baseline:

```text
node --use-system-ca scripts/retrieve-law.mjs food-and-drugs-act
```

That command reads `data/laws/registry.json`, downloads the official Justice Laws XML URL, and writes the current law under `data/laws/current/federal/{law-slug}/`.

The app should use JSON for bill metadata. For actual bill text and current laws, retrieve official XML, then convert it into normalized JSON.
