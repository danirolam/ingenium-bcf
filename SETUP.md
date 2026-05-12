# Injenium — Setup

## TL;DR

```bash
git clone <this repo>
cd project-Injenium
npm install
cp .env.example .env       # edit and add your keys (see below)
npm run dev                # web on :5173, api on :8787
```

Open http://localhost:5173.

## What works without keys (cold demo)

The seed loads real federal bill data from the teammate's `data/` directory:

- **36 recommended bills** (session 45-1) appear in **Bill Monitor**.
- **Bill S-202** (alcohol warning labels on the Food and Drugs Act) has a hand-curated `LawVersion` so the **Delta Workspace** renders a real CanLII-style diff with no API calls.
- **Three demo clients** are seeded: EventPour Technologies, MapleCellars Marketplace, North River Brewing Co.
- **Analyze client impact** for `S-202 × {EventPour | MapleCellars | North River}` returns hand-written, client-specific impact analyses (urgency, recommended adaptations, lawyer-review questions, email draft).
- **Email** sends are simulated (toast: "Email simulated.") and logged to the server console.

For any other (bill, client) pairing, the routes return HTTP 503 with a message that points at `GEMINI_API_KEY`. That is the signal to set the keys below.

## Getting the API keys

You only need two: **Gemini** (required for live AI) and **Resend** (optional, only if you want real emails).

### 1. Google Gemini API key (required for live AI)

1. Go to **https://aistudio.google.com/apikey**.
2. Sign in with the Google account you want to bill (free tier is fine for demo traffic).
3. Click **"Create API key"** → **"Create API key in new project"** (or reuse an existing GCP project).
4. Copy the key. It looks like `AIzaSy…` and is ~40 characters.
5. Paste it into `.env`:

   ```bash
   GEMINI_API_KEY=AIzaSy...your-key-here
   ```

The app uses model `gemini-2.5-flash` with `responseMimeType: "application/json"` to enforce strict JSON output. The free tier allows enough RPM for hackathon demos. If you blow through quota you'll see `[gemini] failed: …` in the server log — Injenium falls back to canned responses where they exist (S-202 paths) and 503s otherwise.

To verify your key works:

```bash
curl -X POST http://localhost:8787/api/bills/45-1-C-224/extract-delta
```

Without a key this returns 503. With a working key it returns a JSON `LawVersion` derived live from C-224 (Food and Drugs Act, natural health products) and the FDA base law.

### 2. Resend API key (optional — real emails)

If you skip this step, every email is simulated and the UI shows "Email simulated." That is fine for demos.

To send real emails:

1. Go to **https://resend.com**, sign up.
2. In the dashboard, **API Keys → Create API Key** → "Sending access".
3. Copy the key (`re_…`).
4. Paste into `.env`:

   ```bash
   RESEND_API_KEY=re_...your-key-here
   ```

5. Decide on a sender. The default `Injenium <onboarding@resend.dev>` works for testing without verifying a domain. If you want to send from your own domain, verify it in Resend (DNS records) and update:

   ```bash
   RESEND_FROM=Injenium <noreply@yourfirm.com>
   ```

6. Set the recipient (where lawyer-notifications land):

   ```bash
   NOTIFY_EMAIL=your.lawyer.inbox@example.com
   ```

> **Resend free tier sends to any address.** No address verification needed for `onboarding@resend.dev`. If you switch to your own domain and use the free tier, Resend may restrict you to verified recipients — check Resend docs.

## .env reference

```env
# .env (gitignored)
GEMINI_API_KEY=AIzaSy...           # required for live AI; without it, only canned demo paths work
RESEND_API_KEY=re_...              # optional; without it, emails are simulated
RESEND_FROM=Injenium <onboarding@resend.dev>
NOTIFY_EMAIL=lawyer@example.com    # recipient for [New Bill Uploaded] / [Client Impact Ready] emails
PORT=8787                          # api port (vite proxies /api here)
```

## Replacing canned data with live AI output

Once `GEMINI_API_KEY` is set, the live paths take over **automatically**. There is no flag to flip; the canned data is only a fallback.

Concretely:

| Action | Without GEMINI_API_KEY | With GEMINI_API_KEY |
|---|---|---|
| Open Delta on **S-202** | Canned LawVersion (FDA s. 5 → s. 5.1) | Same canned LawVersion (it's the seeded snapshot) |
| Open Delta on any **other recommended bill** that links to a registered base law (C-224, C-265, …) | 503 error | **Live** Gemini extraction → real LawVersion |
| Open Delta on a bill with **no registered base law** | 409 error | 409 error (need to add to `data/laws/registry.json` and `bill-law-links.45-1.json`) |
| Analyze impact on **S-202 × demo clients** | Canned analysis | **Live** Gemini analysis (overrides canned) |
| Analyze impact on any other approved law × any client | 503 error | **Live** Gemini analysis |

To force a re-run with live AI on a bill that already has a cached LawVersion, delete it from `server/data/lawVersions.json` (or the whole file to fully reset) and call `extract-delta` again.

To fully reset all runtime state:

```bash
rm server/data/*.json
```

The seed re-populates from `data/` on the next server boot.

## Adding more current laws

Each bill needs a registered base law before Injenium can produce a delta. Today only the **Food and Drugs Act** is registered (`data/laws/current/federal/food-and-drugs-act/`). To add another:

1. Add an entry to `data/laws/registry.json` with `htmlUrl`, `xmlUrl`, and `currentPath`.
2. Run the teammate's script to fetch and normalize the official text:

   ```bash
   node --use-system-ca scripts/retrieve-law.mjs <law-slug>
   ```

3. Add a bill→law link in `data/laws/bill-law-links.45-1.json`.
4. Restart the server (`npm run dev` already restarts on save via tsx watch).

## Scripts the teammate provides

- `node --use-system-ca scripts/retrieve-bill-texts.mjs` — re-fetch all 36 recommended bills' XML and normalized JSON.
- `node --use-system-ca scripts/retrieve-law.mjs <law-slug>` — fetch one current law from Justice Laws.

These are upstream of Injenium: they refresh `data/`. After they run, restart the server and the seed will pick up the new content.

## Troubleshooting

- **"Live extraction is unavailable"** on Open Delta → set `GEMINI_API_KEY` in `.env` and restart.
- **Diff renders empty** on a live extraction → Gemini returned malformed JSON. Check `[gemini] failed: …` in the server log. Re-run; transient JSON parse failures resolve on retry.
- **Bills don't appear in Bill Monitor** → confirm `data/normalized/recommended-bills.45-1.json` exists; `npm run dev`'s server log will say "[seed] failed to read …" if it can't.
- **Stale state after pulling new teammate data** → `rm server/data/*.json && npm run dev`.
- **Port 8787 in use** → set `PORT=…` in `.env` and update `vite.config.ts` proxy target to match.
