/**
 * Pure-module contract tests for server/services/clientScanCore.ts (Phase 1A).
 *
 * The module is REQUIRED: a missing or unloadable clientScanCore.ts FAILS the
 * suite (it skipped pre-landing; now a broken import must never read green).
 *
 * Expected exports:
 *   CHUNK_TOKENS: number, MAX_CHUNKS: number
 *   normalizeAnalysis(raw: unknown): analysis-shaped object, never throws
 *   triageChangesForClient(changes, client): { relevant: ApprovedActChange[], triaged: boolean }
 *   chunkChanges(changes, client): { chunks: ApprovedActChange[][],
 *                                    dropped: { key, anchor, actTitle, reason: "chunk-cap" }[] }
 *   mergeAnalyses(parts[]): merged analysis body
 *   coverageNote(analyzedCount: number, dropped[]): string | null
 *
 * Scorer additions (Phase 1A, two-agent split):
 *   SCAN_BANDS: ["low","medium","high","critical"] (ascending severity)
 *   ANALYZE_EMPHASIS_BANDS: Set — exactly {high, critical}
 *   bandFromScore(score): 0–24 low · 25–49 medium · 50–74 high · 75–100 critical
 *   normalizeScore(raw: unknown): score body, never throws; the band is ALWAYS
 *     recomputed from the (clamped/coerced) score — a claimed band is ignored
 *   heuristicScore(changes, client): deterministic keyless score body, 0..90
 */
import { test, expect } from "@playwright/test";

type Core = Record<string, any>;
let core: Core | null = null;
let loadError = "";

test.beforeAll(async () => {
  // Literal specifiers (so the transpiler can rewrite each), tried in turn:
  // extensionless, ESM-style ".js" (maps to the .ts source), explicit ".ts".
  try {
    core = await import("../../server/services/clientScanCore");
    return;
  } catch (err: any) {
    loadError = String(err?.message ?? err);
  }
  try {
    core = await import("../../server/services/clientScanCore.js");
    return;
  } catch (err: any) {
    loadError = String(err?.message ?? err);
  }
  try {
    // @ts-ignore -- .ts specifier is fine at runtime under Playwright's loader
    core = await import("../../server/services/clientScanCore.ts");
  } catch (err: any) {
    loadError = String(err?.message ?? err);
  }
});

function requireCore(): Core {
  expect(core, `clientScanCore.ts failed to load: ${loadError}`).toBeTruthy();
  return core as Core;
}

// ── Synthetic fixtures ──
const SMALL_OPS = [0, 1, 2].map((i) => ({
  key: `e2e-core-act#${i}`,
  op: ["add", "replace", "repeal"][i],
  anchor: `Section ${i + 1}`,
  instruction: `Synthetic amendment instruction ${i + 1}.`,
}));
const SMALL_CHANGES = [
  {
    slug: "e2e-core-act",
    actTitle: "E2E Core Act",
    citation: "TEST 2026, c. 3",
    ops: SMALL_OPS,
  },
];
const CLIENT = {
  id: "e2e-core-client",
  name: "E2E Core Client",
  industry: "Compliance testing",
  jurisdictions: ["Canada"],
  description: "Synthetic client used only by core-unit specs.",
  createdAt: new Date().toISOString(),
};

/** One ApprovedActChange carrying `count` ops of ~`chars` instruction text each. */
function syntheticChanges(count: number, chars: number) {
  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do ";
  return [
    {
      slug: "synthetic-act",
      actTitle: "Synthetic Act",
      citation: "SYN 2026, c. 9",
      ops: Array.from({ length: count }, (_, i) => ({
        key: `synthetic-act#${i}`,
        op: "replace",
        anchor: `Section ${i + 1}`,
        instruction: `Op ${i}: ${filler.repeat(Math.ceil(chars / filler.length))}`.slice(0, chars),
      })),
    },
  ];
}

/** Flatten a chunk (an ApprovedActChange[]) into its ops. */
function opsOf(chunk: any): any[] {
  if (!Array.isArray(chunk)) return chunk?.ops ?? [];
  return chunk.flatMap((act: any) => (Array.isArray(act?.ops) ? act.ops : [act]));
}

function totalOpCount(changes: any): number {
  if (!Array.isArray(changes)) return 0;
  return changes.reduce(
    (n: number, c: any) => n + (Array.isArray(c?.ops) ? c.ops.length : 1),
    0,
  );
}

test("exports the contract surface (constants + 5 functions)", () => {
  const c = requireCore();
  expect(typeof c.CHUNK_TOKENS).toBe("number");
  expect(c.CHUNK_TOKENS).toBeGreaterThan(0);
  expect(typeof c.MAX_CHUNKS).toBe("number");
  expect(c.MAX_CHUNKS).toBeGreaterThan(0);
  for (const fn of [
    "normalizeAnalysis",
    "triageChangesForClient",
    "chunkChanges",
    "mergeAnalyses",
    "coverageNote",
  ]) {
    expect(typeof c[fn], `${fn} must be exported`).toBe("function");
  }
});

test("normalizeAnalysis never throws on garbage and returns safe defaults", () => {
  const c = requireCore();
  const garbage: unknown[] = [
    null,
    undefined,
    "",
    "garbage",
    [],
    {},
    { affected: "banana", confidence: 99, requiredAdaptations: "not-an-array" },
  ];
  for (const input of garbage) {
    let out: any;
    expect(() => {
      out = c.normalizeAnalysis(input);
    }, `normalizeAnalysis threw on ${JSON.stringify(input)}`).not.toThrow();
    expect(out, `normalizeAnalysis returned nothing for ${JSON.stringify(input)}`).toBeTruthy();
    expect(out.affected, `invalid input must normalize to "unclear"`).toBe("unclear");
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(out.requiredAdaptations)).toBe(true);
    expect(Array.isArray(out.affectedClientAreas)).toBe(true);
    expect(Array.isArray(out.relevantClientText)).toBe(true);
    expect(Array.isArray(out.lawyerVerificationQuestions)).toBe(true);
  }
});

test("triageChangesForClient passes a small payload through untriaged", () => {
  const c = requireCore();
  const out = c.triageChangesForClient(SMALL_CHANGES, CLIENT);
  expect(out.triaged).toBe(false);
  expect(totalOpCount(out.relevant)).toBe(totalOpCount(SMALL_CHANGES));
});

test("triageChangesForClient never returns empty for non-empty input (recall safety)", () => {
  const c = requireCore();
  const nonsenseClient = {
    ...CLIENT,
    id: "e2e-nonsense",
    name: "???",
    industry: "???",
    jurisdictions: [],
    description: "",
  };
  // Small payload: passes through whole. Large payload sharing zero vocabulary
  // with the client: the recall safety net must still return everything.
  const small = c.triageChangesForClient(SMALL_CHANGES, nonsenseClient);
  expect(totalOpCount(small.relevant)).toBe(totalOpCount(SMALL_CHANGES));

  const big = syntheticChanges(40, Math.ceil((c.CHUNK_TOKENS * 4) / 8));
  const out = c.triageChangesForClient(big, nonsenseClient);
  expect(totalOpCount(out.relevant)).toBe(totalOpCount(big));
});

test("chunkChanges splits ~40 one-k-token ops into >1 chunks, partitioning exactly", () => {
  const c = requireCore();
  // Size ops relative to the real budget: ~8 ops per chunk, 40 ops ≈ 5 chunks.
  const charsPerOp = Math.ceil((c.CHUNK_TOKENS * 4) / 8);
  const changes = syntheticChanges(40, charsPerOp);
  const inputOps = changes[0].ops;
  const { chunks, dropped } = c.chunkChanges(changes, CLIENT);

  expect(Array.isArray(chunks)).toBe(true);
  expect(chunks.length).toBeGreaterThan(1);

  // Every input op lands in exactly one chunk OR in dropped — never both,
  // never twice, never lost.
  const seen = new Map<string, number>();
  for (const chunk of chunks) {
    for (const op of opsOf(chunk)) seen.set(op.key, (seen.get(op.key) ?? 0) + 1);
  }
  for (const d of dropped ?? []) seen.set(d.key, (seen.get(d.key) ?? 0) + 1);
  for (const op of inputOps) {
    expect(seen.get(op.key), `op ${op.key} must appear exactly once`).toBe(1);
  }
  expect(seen.size).toBe(inputOps.length);

  // Rough serialized budget: each chunk fits in CHUNK_TOKENS * 4 chars.
  const sizeOf = (chunk: any) =>
    typeof c.serializeChanges === "function"
      ? c.serializeChanges(chunk).length
      : JSON.stringify(chunk).length;
  for (const chunk of chunks) {
    expect(sizeOf(chunk)).toBeLessThanOrEqual(c.CHUNK_TOKENS * 4);
  }
});

test("chunkChanges over the cap drops entries carrying key + actTitle + 'chunk-cap'", () => {
  const c = requireCore();
  // ~5 ops per chunk, enough ops to need MAX_CHUNKS + 3 chunks → must drop.
  const charsPerOp = Math.ceil((c.CHUNK_TOKENS * 4) / 5);
  const changes = syntheticChanges((c.MAX_CHUNKS + 3) * 5, charsPerOp);
  const { chunks, dropped } = c.chunkChanges(changes, CLIENT);

  expect(chunks.length).toBeLessThanOrEqual(c.MAX_CHUNKS);
  expect(Array.isArray(dropped)).toBe(true);
  expect(dropped.length).toBeGreaterThan(0);
  for (const d of dropped) {
    expect(typeof d.key).toBe("string");
    expect(d.key.length).toBeGreaterThan(0);
    expect(typeof d.actTitle).toBe("string");
    expect(d.actTitle.length).toBeGreaterThan(0);
    expect(d.reason).toBe("chunk-cap");
  }
});

// ── mergeAnalyses laws ──
function analysisFixture(over: Record<string, unknown> = {}) {
  return {
    affected: "no",
    impactLevel: "low",
    urgency: "low",
    timing: "No immediate timing pressure.",
    whyItAffectsClient: "Synthetic merge fixture.",
    affectedClientAreas: [],
    requiredAdaptations: [],
    relevantClientText: [],
    lawyerVerificationQuestions: [],
    emailDraft: { subject: "s", body: "b" },
    confidence: 0.9,
    humanReviewRequired: false,
    humanReviewReason: null,
    ...over,
  };
}
const ADAPTATION = {
  area: "Privacy terms",
  currentIssue: "Consent language predates the amendment.",
  recommendation: "Re-paper the consent flow.",
  reason: "Section 2 is replaced.",
};

test("mergeAnalyses: impact severity takes the max ([low, critical] -> critical)", () => {
  const c = requireCore();
  const merged = c.mergeAnalyses([
    analysisFixture({ impactLevel: "low" }),
    analysisFixture({ impactLevel: "critical" }),
  ]);
  expect(merged.impactLevel).toBe("critical");
});

test("mergeAnalyses: affected takes the affirmative ([yes, no] -> yes)", () => {
  const c = requireCore();
  const merged = c.mergeAnalyses([
    analysisFixture({ affected: "yes" }),
    analysisFixture({ affected: "no" }),
  ]);
  expect(merged.affected).toBe("yes");
});

test("mergeAnalyses: confidence takes the minimum", () => {
  const c = requireCore();
  const merged = c.mergeAnalyses([
    analysisFixture({ confidence: 0.9 }),
    analysisFixture({ confidence: 0.4 }),
    analysisFixture({ confidence: 0.7 }),
  ]);
  expect(merged.confidence).toBeCloseTo(0.4, 5);
});

test("mergeAnalyses: humanReviewRequired ORs across parts", () => {
  const c = requireCore();
  const merged = c.mergeAnalyses([
    analysisFixture({ humanReviewRequired: false }),
    analysisFixture({ humanReviewRequired: true, humanReviewReason: "part 2 flagged" }),
  ]);
  expect(merged.humanReviewRequired).toBe(true);
});

test("mergeAnalyses: identical adaptations dedupe to one", () => {
  const c = requireCore();
  const merged = c.mergeAnalyses([
    analysisFixture({ requiredAdaptations: [{ ...ADAPTATION }] }),
    analysisFixture({ requiredAdaptations: [{ ...ADAPTATION }] }),
  ]);
  const matches = merged.requiredAdaptations.filter(
    (r: any) => r.area === ADAPTATION.area && r.recommendation === ADAPTATION.recommendation,
  );
  expect(matches).toHaveLength(1);
});

test("mergeAnalyses: verification questions are capped at exactly 10", () => {
  const c = requireCore();
  const q = (n: number, part: string) =>
    Array.from({ length: n }, (_, i) => `Question ${part}-${i + 1}?`);
  // 14 distinct questions in → the cap must bite at exactly 10.
  const merged = c.mergeAnalyses([
    analysisFixture({ lawyerVerificationQuestions: q(7, "a") }),
    analysisFixture({ lawyerVerificationQuestions: q(7, "b") }),
  ]);
  expect(merged.lawyerVerificationQuestions.length).toBe(10);
});

test("coverageNote: null when nothing was dropped, names anchors when something was", () => {
  const c = requireCore();
  expect(c.coverageNote(5, [])).toBeNull();

  const note = c.coverageNote(5, [
    { key: "x-act#1", actTitle: "X Act", anchor: "Section 7", reason: "chunk-cap" },
    { key: "x-act#2", actTitle: "X Act", anchor: "Section 9", reason: "chunk-cap" },
  ]);
  expect(typeof note).toBe("string");
  expect(note).toContain("Section 7");
  expect(note).toContain("Section 9");
});

test("coverageNote distinguishes volume-cap drops from AI-unavailable skips", () => {
  const c = requireCore();
  const note = c.coverageNote(3, [
    { key: "x-act#1", actTitle: "X Act", anchor: "Section 7", reason: "chunk-cap" },
    { key: "x-act#2", actTitle: "X Act", anchor: "Section 9", reason: "ai-unavailable" },
  ]);
  expect(typeof note).toBe("string");
  // Each gap is attributed to its REAL cause — a rate-limited skip must not
  // read as a volume-cap drop in a lawyer-facing brief.
  expect(note).toContain("volume cap");
  expect(note).toContain("Section 7");
  expect(note).toContain("AI unavailable");
  expect(note).toContain("Section 9");
  expect(note.indexOf("Section 9")).toBeGreaterThan(note.indexOf("AI unavailable"));
});

// ── Scorer (two-agent split): bands, normalizeScore, heuristicScore ──────────

/**
 * Fixture client for heuristicScore. Terms are mined from industry /
 * jurisdictions / description (lowercased words ≥4 chars), so the snippets
 * below are engineered against THAT vocabulary: every "overlap" snippet reuses
 * several of the client's distinctive words, every "neutral" snippet shares
 * none of them.
 */
const SCORE_CLIENT = {
  id: "e2e-score-client",
  name: "Maplecart Grocers",
  industry: "Retail grocery distribution",
  jurisdictions: ["Canada"],
  description:
    "Operates refrigerated grocery logistics: food labelling compliance, perishable storage temperature monitoring, and delivery fleet licensing.",
  createdAt: new Date().toISOString(),
};
const OVERLAP_SNIPPETS = [
  "food labelling disclosures for grocery products",
  "refrigerated storage temperature monitoring of perishable goods",
  "delivery fleet licensing renewals for grocery distribution",
];
const NEUTRAL_SNIPPETS = [
  "maritime beacon luminosity certification",
  "offshore platform inspection intervals",
  "aviation runway marking colour codes",
];

/**
 * One act with 4 ops: the first `overlapping` reuse the client's vocabulary,
 * the rest are from a disjoint domain. Total op count is FIXED so the two
 * monotonicity inputs differ only in how many ops overlap.
 */
function scoredChanges(overlapping: number) {
  const ops = Array.from({ length: 4 }, (_, i) => {
    const snippet =
      i < overlapping
        ? OVERLAP_SNIPPETS[i % OVERLAP_SNIPPETS.length]
        : NEUTRAL_SNIPPETS[i % NEUTRAL_SNIPPETS.length];
    return {
      key: `e2e-score-act#${i}`,
      op: "replace",
      anchor: `Section ${i + 1}`,
      instruction: `Section ${i + 1} is amended to govern ${snippet}.`,
    };
  });
  return [
    {
      slug: "e2e-score-act",
      actTitle: "Statutes Amendment Act",
      citation: "TEST 2026, c. 4",
      ops,
    },
  ];
}

test("scorer exports: SCAN_BANDS ascending, ANALYZE_EMPHASIS_BANDS = exactly {high, critical}", () => {
  const c = requireCore();
  // Canonical ascending-severity order — the same order bandFromScore maps.
  expect(c.SCAN_BANDS).toEqual(["low", "medium", "high", "critical"]);

  expect(c.ANALYZE_EMPHASIS_BANDS instanceof Set).toBe(true);
  expect(c.ANALYZE_EMPHASIS_BANDS.size).toBe(2);
  expect(c.ANALYZE_EMPHASIS_BANDS.has("high")).toBe(true);
  expect(c.ANALYZE_EMPHASIS_BANDS.has("critical")).toBe(true);

  for (const fn of ["bandFromScore", "normalizeScore", "heuristicScore"]) {
    expect(typeof c[fn], `${fn} must be exported`).toBe("function");
  }
});

test("bandFromScore boundary table: 0–24 low · 25–49 medium · 50–74 high · 75–100 critical", () => {
  const c = requireCore();
  const table: Array<[number, string]> = [
    [0, "low"],
    [24, "low"],
    [25, "medium"],
    [49, "medium"],
    [50, "high"],
    [74, "high"],
    [75, "critical"],
    [100, "critical"],
  ];
  for (const [score, band] of table) {
    expect(c.bandFromScore(score), `bandFromScore(${score})`).toBe(band);
  }
});

test("normalizeScore clamps out-of-range scores to 0..100 (band follows the clamp)", () => {
  const c = requireCore();
  const below = c.normalizeScore({ score: -5 });
  expect(below.score).toBe(0);
  expect(below.band).toBe("low");

  const above = c.normalizeScore({ score: 250 });
  expect(above.score).toBe(100);
  expect(above.band).toBe("critical");
});

test("normalizeScore never throws on garbage and ALWAYS recomputes the band from the score", () => {
  const c = requireCore();
  const garbage: unknown[] = [null, undefined, "x", [], {}, { score: "high" }];
  for (const input of garbage) {
    let out: any;
    expect(() => {
      out = c.normalizeScore(input);
    }, `normalizeScore threw on ${JSON.stringify(input)}`).not.toThrow();
    expect(out, `normalizeScore returned nothing for ${JSON.stringify(input)}`).toBeTruthy();
    expect(typeof out.score, `score must coerce to a number for ${JSON.stringify(input)}`).toBe(
      "number",
    );
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(out.band, `band must be recomputed from the score`).toBe(
      c.bandFromScore(out.score),
    );
    expect(typeof out.rationale).toBe("string");
    expect(Array.isArray(out.topAreas)).toBe(true);
  }

  // A lying band is IGNORED — score 10 normalizes to "low", whatever it claims.
  const lying = c.normalizeScore({ score: 10, band: "critical" });
  expect(lying.score).toBe(10);
  expect(lying.band).toBe("low");
});

test("heuristicScore is deterministic: same inputs ⇒ deep-identical output", () => {
  const c = requireCore();
  const first = c.heuristicScore(scoredChanges(3), SCORE_CLIENT);
  const second = c.heuristicScore(scoredChanges(3), SCORE_CLIENT);
  expect(second).toEqual(first);
});

test("heuristicScore stays within 0..90 and self-identifies as a heuristic", () => {
  const c = requireCore();
  // No changes at all / 4 zero-overlap ops / 3-of-4 overlapping ops.
  for (const changes of [[], scoredChanges(0), scoredChanges(3)]) {
    const out = c.heuristicScore(changes, SCORE_CLIENT);
    expect(typeof out.score).toBe("number");
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score, "a keyless heuristic must never claim a full 100").toBeLessThanOrEqual(90);
    expect(out.band).toBe(c.bandFromScore(out.score));
    expect(out.rationale, "the rationale must disclose its heuristic origin").toMatch(
      /heuristic/i,
    );
  }
});

test("heuristicScore monotonicity: more client-term-overlapping ops never scores lower", () => {
  const c = requireCore();
  const fewer = c.heuristicScore(scoredChanges(1), SCORE_CLIENT);
  const more = c.heuristicScore(scoredChanges(3), SCORE_CLIENT);
  expect(
    more.score,
    `3-of-4 overlapping ops (${more.score}) must score ≥ 1-of-4 (${fewer.score})`,
  ).toBeGreaterThanOrEqual(fewer.score);
});

// ── Prior-brief serialization (regen-as-revision) ────────────────────────────

test("serializePriorBrief never throws, carries the verdict + adaptations, and caps its size", () => {
  const c = requireCore();
  // Never throws on garbage / partial records (old store entries).
  for (const garbage of [null, undefined, "", 42, [], {}]) {
    expect(() => c.serializePriorBrief(garbage)).not.toThrow();
    expect(typeof c.serializePriorBrief(garbage)).toBe("string");
  }

  const out = c.serializePriorBrief({
    affected: "yes",
    impactLevel: "high",
    urgency: "immediate",
    timing: "Coming into force one year after royal assent.",
    whyItAffectsClient: "Supply terms conflict with the new list regime.",
    affectedClientAreas: ["Supply terms", "Import workflow"],
    requiredAdaptations: [
      { area: "Hospital supply terms", recommendation: "Re-paper the authorization-gated clause." },
    ],
    relevantClientText: [{ source: "Terms & Conditions" }],
    lawyerVerificationQuestions: ["Does the client rely on per-patient SAP letters?"],
    humanReviewRequired: true,
    humanReviewReason: "Material exposure.",
  });
  expect(out).toContain("impact=high");
  expect(out).toContain("Hospital supply terms");
  expect(out).toContain("Re-paper the authorization-gated clause.");
  expect(out).toContain("Human review was required");

  // Size cap: a pathological record must not produce an unbounded block.
  const huge = c.serializePriorBrief({
    whyItAffectsClient: "x".repeat(50_000),
    requiredAdaptations: Array.from({ length: 100 }, (_, i) => ({
      area: `Area ${i}`,
      recommendation: "y".repeat(2_000),
    })),
  });
  expect(huge.length).toBeLessThanOrEqual(6_100);
});
