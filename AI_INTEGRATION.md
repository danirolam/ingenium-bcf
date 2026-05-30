# AI integration — handoff guide

Ingenium runs fully today with **no AI key** — every screen produces real,
structured output using deterministic logic. Turning on live Gemini synthesis is
essentially one step: **add `GEMINI_API_KEY`**. Nothing else needs to change.

This guide is everything the team needs to wire it.

## TL;DR

1. Get a free key: https://aistudio.google.com/apikey
2. Add it where the app runs:
   - **Production (Vercel):** Project → Settings → Environment Variables → add `GEMINI_API_KEY` → redeploy.
   - **Local:** put it in `.env` → `GEMINI_API_KEY=AIza...`
3. Confirm it took:
   - `npm run verify:gemini` — pings the model, prints `OK` or a specific `FAIL`.
   - `GET /api/health` → `ai.enabled` flips to `true`.

The AI features activate automatically — **no code changes**.

## Where AI is used (and only there)

AI is used in exactly three *synthesis* spots. Everything else — bill ingestion,
the legislative path, practice‑area tagging, client matching, the diff renderer —
is deterministic and never calls a model.

| Touchpoint | Function (`server/services/gemini.ts`) | What the key turns on | Fallback without a key |
| --- | --- | --- | --- |
| **Client impact memo** | `analyzeClientImpact` (used by `routes/clientImpact.ts`) | A real, client‑specific exposure memo for **any** client × approved law | A deterministic synthesized memo — still structured and usable |
| **Delta extraction** | `extractAmendmentsFromBill` (used by `routes/bills.ts`) | The structured amendment a bill makes to a **registered** Act | A one‑sided "proposed text" stub + a link to the current Act on Justice Laws Canada |
| **Updated Act text** | `generateUpdatedLawText` | The "after" side of the before/after diff for a registered Act | (same stub as above) |

All three return `null` on a missing key, an invalid key, a quota error, or a
malformed response — the route then uses its fallback. **A bad key never breaks
the app**; it just doesn't upgrade the output.

## The model

- Default: `gemini-2.5-flash` (fast, inexpensive, good for this workload).
- Override with `GEMINI_MODEL` (e.g. `gemini-3-flash`, `gemini-2.5-pro`) — see `.env.example`.
- Strict JSON is enforced (`responseMimeType: "application/json"`) and every response is `JSON.parse`d defensively.

## Verifying

```bash
# 1. Smoke test — pings Gemini with a trivial JSON prompt, clear pass/fail.
npm run verify:gemini

# 2. Runtime status (after deploy):
curl https://ingenium-bcf.vercel.app/api/health
# → { "ok": true, "ai": { "enabled": true, "model": "gemini-2.5-flash" }, "email": { "enabled": false } }

# 3. End-to-end: Client scan → pick a client → Analyze.
#    With a key, the memo is Gemini-generated; without, it's the synthesized fallback.
```

`verify:gemini` already distinguishes the common failures: empty key, key rejected
by Google, and model‑not‑available (it suggests an alternate `GEMINI_MODEL`).

## Getting real two‑sided diffs (optional, beyond the key)

The before/after **legal delta** needs the *current consolidated text* of the
affected Act to diff against. Five Acts are registered today (Feeds, Fertilizers,
Seeds, Pest Control Products, Food and Drugs). With a key, those produce full
two‑sided diffs; every other Act shows the one‑sided stub (with a Justice Laws
link to today's text).

To add more Acts so more bills get real diffs — a **data** step, independent of the key:

1. Register the Act in `data/laws/registry.json` (`htmlUrl` / `xmlUrl` / `currentPath`).
2. Fetch + normalize its current text: `node --use-system-ca scripts/retrieve-law.mjs <law-slug>`.
3. Restart the server. The next `extract-delta` for a bill touching that Act produces a full diff.

The **client‑impact memo works for everything** the moment the key is added — it
doesn't depend on the registry.

## Cost / safety

- Calls are per‑action (open a delta, run an analysis) — no background or idle spend.
- The free tier covers demo traffic; watch quota only if you batch.
- No secrets in the repo — the key lives only in `.env` (git‑ignored) or Vercel env vars.

## Optional: email notifications

The lawyer‑notification email uses the same pattern. Add `RESEND_API_KEY`
(+ `RESEND_FROM`, `NOTIFY_EMAIL`) to send for real; without it, emails are
simulated and logged. `/api/health` reports `email.enabled`.
