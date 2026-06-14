# AI integration — handoff guide

**Status: live.** The Anthropic key (`ANTHROPIC_API_KEY`) is wired in Vercel
(Production + Development) and powers everything; `/api/health` reports it. The
app still runs fully with **no key** — every screen has a deterministic
fallback — so a bad or missing key can never break it.

## TL;DR

- **Primary key:** `ANTHROPIC_API_KEY` (Claude; console.anthropic.com). Already
  set in Vercel → Settings → Environment Variables, and in the local `.env`.
- **Optional:** `GEMINI_API_KEY` — if present, Gemini takes the client memo and
  the legacy extraction path instead.
- Confirm wiring: `GET /api/health` → `ai.anthropic.enabled` / `ai.gemini.enabled`.

## Where AI is used (and only there)

Everything else — bill ingestion, the legislative path, practice‑area tagging,
client matching, the diff renderer — is deterministic and never calls a model.

| Touchpoint | Code | Key | Fallback without a key |
| --- | --- | --- | --- |
| **Provision delta (step 02)** — interpreting how a bill's clauses amend the Act | `claude.ts` (`interpretAmendmentsClaude`, tool-use) + `scalpel.ts` (anchor resolution), used by `POST /bills/:id/provision-delta` | `ANTHROPIC_API_KEY` | The structured parser alone — plainly-worded amendments still resolve; complex ones report "AI key missing — cannot interpret …" |
| **Client impact memo (step 04)** | `routes/clientImpact.ts`: Gemini's `analyzeClientImpact` → else `claudeJson(buildImpactPrompt(...))` | `GEMINI_API_KEY`, else `ANTHROPIC_API_KEY` | Canned demo memo, else a deterministic synthesized memo |
| **Legacy two‑sided extraction** | `gemini.ts` (`extractAmendmentsFromBill`, `generateUpdatedLawText`) | `GEMINI_API_KEY` | One‑sided stub + Justice Laws link |

Every call returns `null` on a missing key, an invalid key, a rate limit, or a
malformed response — the route then uses its fallback.

## The models

- Delta interpreter: `claude-haiku-4-5` by default (fast, cheap, mechanical
  extraction). Override with `ANTHROPIC_MODEL` (e.g. `claude-sonnet-4-6` for more
  depth); the anchor-resolution pass separately via `ANTHROPIC_SCALPEL_MODEL`.
- Gemini (optional path): `gemini-2.5-flash`, override `GEMINI_MODEL`.
- A fresh Anthropic key starts on tier-1 rate limits; big omnibus bills may
  return `aiIncomplete: true` on the first pass — re-run with `?refresh=1`, or
  the limits grow with usage.

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

## The Act corpus (already done — all 964 federal Acts)

The before/after **legal delta** needs the *current consolidated text* of the
affected Act to diff against. **The full federal corpus is in place**: all 964
consolidated Acts, ingested from the public Justice Laws website
(`scripts/ingest-acts.mjs --all`) and served from **Vercel Blob**
(`scripts/upload-acts-blob.mjs` → `acts/<slug>.json`, indexed by the committed
`data/laws/blob-manifest.json`). The server loads an Act from the local file
first (dev + the 5 bundled demo Acts), then from Blob, with in‑memory caching.

So the delta resolves against any federal Act today. The structured parser
handles plainly‑worded amendments on its own; the AI key unlocks interpretation
of the complex ones (the UI/API says "AI key missing — cannot interpret …" for
exactly those until the key is added).

To refresh the corpus later (new consolidations):

1. `node --use-system-ca scripts/ingest-acts.mjs --all --write-registry`
2. `node scripts/upload-acts-blob.mjs` — needs `BLOB_READ_WRITE_TOKEN` in
   `.env.local`; it's a *sensitive* env var, so copy it from the dashboard
   (Storage → the Blob store) — `vercel env pull` returns it empty.
3. Commit the updated `registry.json` + `blob-manifest.json`, deploy.

The **client‑impact memo works for everything** the moment the key is added — it
doesn't depend on the corpus.

## Cost / safety

- Calls are per‑action (open a delta, run an analysis) — no background or idle spend.
- The free tier covers demo traffic; watch quota only if you batch.
- No secrets in the repo — the key lives only in `.env` (git‑ignored) or Vercel env vars.

## Optional: email notifications

The lawyer‑notification email uses the same pattern. Add `RESEND_API_KEY`
(+ `RESEND_FROM`, `NOTIFY_EMAIL`) to send for real; without it, emails are
simulated and logged. `/api/health` reports `email.enabled`.
