# `eval/` — grading stages 3–4 against a lawyer's gold benchmark

This harness measures whether the **client scan (stage 3)** and **client brief (stage 4)** agents
are production-quality, by comparing their output **side by side** against a benchmark a practicing
BCF lawyer authored: 7 real companies, each paired with a real Parliament 45-1 bill, plus the
lawyer's model *Impact assessment* and *BCF's Services* pitch.

Unlike `e2e/` (keyless, deterministic, CI), this runs against **your keyed local server** so it
grades the real Anthropic brief. It validates **stages 3–4 only** — stages 1–2 are deferred, so we
deterministically author their output (approved `provisionDeltas` + `approvals`) in the exact
schema they will emit (`fixtures/bill-deltas.ts`, mirroring `e2e/seed-demo.ts`).

## Run order

```bash
# 1. Seed: write the 5 bills' deltas/approvals + upsert the 7 eval clients (idempotent)
npx tsx eval/seed-eval.ts

# 2. Start a KEYED server (ANTHROPIC_API_KEY in your .env) in another terminal
npm run dev          # API on :8787, web on :5173

# 3. Run the eval (scan matrix + briefs → eval/out/)
npx tsx eval/run-eval.ts
#    EVAL_BASE_URL=http://localhost:8787 by default

# 4. Read the results, starting with the matrix
open eval/out/INDEX.md
```

`eval/out/` is generated (gitignored). Cost per run ≈ 35 scorer calls (~600 tokens each) + 7 briefs
(~10k tokens each).

## The 7 pairs

The client→bill pairing is the **answer** — it is withheld from `clients.json` and lives only in
`gold/profiles.json`. The scan matrix scores **every client × all 5 bills**, so bill selection is
itself under test.

| Client | Assigned bill | Act(s) | Lawyer's read |
|--------|--------------|--------|----------------|
| Nutrien | C-273 | Feeds / Fertilizers / Seeds / Pest Control Products / Food & Drugs | high — multi-Act beneficiary |
| Bayer | C-273 | (same five) | high — multi-Act beneficiary |
| Canneberges Bieler | C-273 | (same five) | **LOW — negative control** (end-user, no direct impact) |
| GDMS–Canada | C-233 | Export and Import Permits Act | high — new export-permit obligations |
| WestJet | C-250 | Canada Labour Code (flight attendants) | high — flight-attendant labour cost |
| Dollarama | C-251 | Customs Act + Customs Tariff | high — forced/child-labour supply-chain |
| Air Canada | C-259 | Canada Labour Code (fair representation) | high — employer-domination AMPs |

Note C-273 (5 Acts), C-250 and C-259 (both amend the Canada Labour Code) make this discriminative:
the scorer must pick the *right* Labour-Code bill for WestJet vs Air Canada, and keep Canneberges
low even on its own assigned bill.

## What success looks like

`run-eval.ts` computes two checks into `INDEX.md`; the rest is human judgment:

1. **Bill selection** — each client's assigned bill is its **top-scoring** bill across the 5.
2. **Negative control** — Canneberges stays **low** across all 5 bills (no keyword false-positives).
3. **Brief quality** (per-pair side-by-sides, judged by hand): are the right Acts named, is the
   direction (benefit vs obligation) right, is the magnitude plausible, do the suggested services
   line up with the gold, and is the tone conditional / Act-qualified / non-advisory? Note the gold
   speaks directively ("BCF could…"); our briefs are intentionally conditional ("Counsel may
   wish…") after the tone overhaul — compare **substance**, not register.

## Leakage contract (enforced)

- **No `server/` code imports `eval/`** (`grep -rn "eval/" server/` → empty) — the pipeline cannot
  read the gold.
- The `Client` type has no bill field, so the pairing **cannot** leak through `clients.json`.
- `clients.json` carries the lawyer's **input** fields only (Industry / Description / Policies /
  Operations). The answer phrases stay in the gold: `grep -nE "trusted jurisdiction|90-day|BCF could|\$100,000" server/data/clients.json` → **zero**.
- The 7 client ids are protected in `e2e/seed.ts` `PROTECTED_CLIENT_IDS`; the eval deltas/approvals
  carry `__evalSeed` and the e2e teardown leaves them alone.

## Files

| File | Role |
|------|------|
| `fixtures/bill-deltas.ts` | Deterministic stage-1/2 output for the 5 bills (approved deltas + approvals), from real `bills.json` clause text. C-273 → 5 `ProvisionDelta`s. |
| `fixtures/clients.ts` | The 7 clients' **input halves** (lawyer profiles minus the answer). |
| `gold/profiles.json` | The lawyer's **answer key** (per client: assigned bill + impact + services). |
| `seed-eval.ts` | Writes the fixtures to the stores + upserts the clients. Idempotent. |
| `run-eval.ts` | Drives the keyed server; writes the matrix + side-by-sides to `out/`. |

## Gold cleaning log

`gold/profiles.json` is the lawyer's prose **verbatim** except for the edits below (decision:
clean + log). The input halves in `fixtures/clients.ts` were lifted from the same profiles
unchanged except for the normalizations noted there (jurisdictions, omitted `N/A` fields, names).

1. **GDMS-Canada — impact paragraph un-spliced.** The source had a sentence broken mid-word with
   another paragraph inserted into the gap: *"…lengthen export approval timelines, an* **As a major
   exporter … defence industry.** *d require additional internal monitoring and record-keeping
   procedures."* Rejoined the split word (`an` + `d` → `and`) so the first sentence reads
   *"…lengthen export approval timelines, and require additional internal monitoring and
   record-keeping procedures."*, and moved the *"As a major exporter…"* sentence to follow it. No
   words added or removed beyond the rejoin.
2. **Dollarama — two editor annotations removed from the impact section.** A French bracketed note
   (`[Le fabricant/importateur doit pouvoir prouver…]`) and a `[+LIEN EXPLICITE AVEC OFFRE DE
   SERVICE DE BCF…]` placeholder were deleted. The lawyer's surrounding prose is unchanged (the
   "build trust" idea the placeholder gestured at already appears, fully written, in the BCF's
   Services text).
3. **Names — French archetype scaffolding stripped** (affects `fixtures/clients.ts`, not the gold):
   GDMS-Canada / Dollarama / Air Canada profiles were prefixed with bracketed French persona notes
   (e.g. `[CLIENT DANS L'INDUSTRIE MILITAIRE…]`); used the real company name only. Bayer's
   `(acquired Monsanto)` note dropped from the name.
4. **CN Railway (#8 in the source doc) excluded entirely** — its bill **C-284** is not in the 45-1
   snapshot. Deferred, not cleaned.

Resumption / design notes: `~/.claude/plans/yes-and-also-rememebr-merry-hartmanis.md`.
