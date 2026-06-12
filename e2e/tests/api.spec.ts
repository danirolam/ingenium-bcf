/**
 * Request-level contracts for the stage 3-4 backend.
 *
 * Passing TODAY: scan-ready list/detail/404, analyze validation (400/404),
 * keyless analyze + by-pair, clients CRUD + analyses cascade.
 * The "scorer" block is the acceptance test for the two-agent split
 * (Phase 1A, landing in parallel): POST /api/client-impact/scan and
 * GET /api/client-impact/scans — band-only views, the numeric score must
 * NEVER appear in any response, deterministic keyless fallback, scan cascade
 * on client delete.
 * The "brief library" block is the acceptance test for the stage-4 picker
 * backend (commit a1f3f13): GET /api/client-impact/briefs — bills sorted
 * latestAt desc, latest-per-pair client entries with the band joined from the
 * scans store (never the numeric score) — and the optional transient
 * `guidance` string on POST /analyze.
 */
import { test, expect } from "@playwright/test";
import { SEED_ACT, SEED_APPROVED_KEYS } from "../seed";
import { API, SCAN_BAND_VALUES, seedState, waitForApiReady } from "./helpers";

test.beforeAll(async () => {
  await waitForApiReady();
});

// ── Scorer response invariants ────────────────────────────────────────────────

/**
 * Every path in `node` whose property key is exactly "score" — the numeric
 * score is a backend-only ranking key, so for every scorer payload this MUST
 * come back empty, at ANY depth.
 */
function scoreKeyPaths(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((v, i) => scoreKeyPaths(v, `${path}[${i}]`));
  }
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === "score" ? [`${path}.${k}`] : []),
      ...scoreKeyPaths(v, `${path}.${k}`),
    ]);
  }
  return [];
}

function expectNoScoreAnywhere(body: unknown): void {
  expect(
    scoreKeyPaths(body),
    "the numeric score must never leave the backend",
  ).toEqual([]);
}

const BAND_SEVERITY: Record<string, number> = Object.fromEntries(
  SCAN_BAND_VALUES.map((b, i) => [b, i]),
);

/** Structural contract of one scan view (POST /scan and GET /scans share it). */
function expectScanViewShape(scan: any, clientId: string, billId: string): void {
  expect(scan, "response must carry a scan view").toBeTruthy();
  expect(typeof scan.id).toBe("string");
  expect(scan.id.length).toBeGreaterThan(0);
  expect(scan.clientId).toBe(clientId);
  expect(scan.billId).toBe(billId);
  expect(SCAN_BAND_VALUES as readonly string[]).toContain(scan.band);
  expect(typeof scan.rationale).toBe("string");
  expect(scan.rationale.length).toBeGreaterThan(0);
  expect(Array.isArray(scan.topAreas)).toBe(true);
  for (const area of scan.topAreas) expect(typeof area).toBe("string");
  expect(["ai", "fallback"]).toContain(scan.source);
  expect(typeof scan.scannedAt).toBe("string");
  expect(Number.isNaN(Date.parse(scan.scannedAt)), "scannedAt must parse").toBe(false);
  expect(typeof scan.hasBrief).toBe("boolean");
}

test.describe("scan-ready", () => {
  test("lists the seeded bill with 3 approved ops", async ({ request }) => {
    const st = await seedState();
    const res = await request.get(`${API}/api/client-impact/scan-ready`);
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);

    const mine = list.find((b: any) => b.billId === st.billId);
    expect(mine, `seeded bill ${st.billId} missing from scan-ready`).toBeTruthy();
    expect(mine).toMatchObject({
      billId: st.billId,
      billNumber: st.billNumber,
      title: st.title,
      status: st.status,
      approvedOpCount: 3,
      actTitles: [SEED_ACT.title],
    });
    expect(typeof mine.computedAt).toBe("string");
    expect(mine.computedAt.length).toBeGreaterThan(0);
  });

  test("a bill with a delta but ZERO approvals is not scan-ready", async ({ request }) => {
    const st = await seedState();
    const res = await request.get(`${API}/api/client-impact/scan-ready`);
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(
      list.some((b: any) => b.billId === st.billId2),
      `bill ${st.billId2} has a delta but no approvals — it must NOT be scan-ready`,
    ).toBe(false);
  });

  test("detail returns the approved changes with row-consistent before/after text", async ({
    request,
  }) => {
    const st = await seedState();
    const res = await request.get(`${API}/api/client-impact/scan-ready/${st.billId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.billId).toBe(st.billId);
    expect(body.approvedCount).toBe(3);
    expect(Array.isArray(body.changes)).toBe(true);
    expect(body.changes).toHaveLength(1);

    const change = body.changes[0];
    expect(change).toMatchObject({
      slug: SEED_ACT.slug,
      actTitle: SEED_ACT.title,
      citation: SEED_ACT.citation,
    });
    expect(change.ops).toHaveLength(3);

    const byKey: Record<string, any> = Object.fromEntries(
      change.ops.map((o: any) => [o.key, o]),
    );
    for (const key of SEED_APPROVED_KEYS) {
      const op = byKey[key];
      expect(op, `op ${key} missing from detail`).toBeTruthy();
      expect(typeof op.anchor).toBe("string");
      expect(typeof op.instruction).toBe("string");
      expect(op.instruction.length).toBeGreaterThan(0);
    }
    expect(byKey["e2e-test-act#0"].op).toBe("add");
    expect(byKey["e2e-test-act#1"].op).toBe("replace");
    expect(byKey["e2e-test-act#2"].op).toBe("repeal");

    // before/after must be consistent with the seeded diff rows:
    //   #0 add     -> no before, after  = "Amended text of section 1"
    //   #1 replace -> before+after for section 2
    //   #2 repeal  -> before only, no after
    expect(byKey["e2e-test-act#0"].beforeText ?? null).toBeNull();
    expect(byKey["e2e-test-act#0"].afterText).toBe("Amended text of section 1");
    expect(byKey["e2e-test-act#1"].beforeText).toBe("Original text of section 2");
    expect(byKey["e2e-test-act#1"].afterText).toBe("Amended text of section 2");
    expect(byKey["e2e-test-act#2"].beforeText).toBe("Original text of section 3");
    expect(byKey["e2e-test-act#2"].afterText ?? null).toBeNull();
  });

  test("detail 404s for an unknown bill", async ({ request }) => {
    const res = await request.get(
      `${API}/api/client-impact/scan-ready/e2e-no-such-bill`,
    );
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: "bill not_found" });
  });
});

/**
 * The fast scorer agent (Phase 1A, two-agent split).
 *
 * ORDERING: this block must run BEFORE the "analyze" block below — the
 * hasBrief:false assertions need (client-corebloom, bill1) to still be
 * brief-less, and the analyze block (plus this block's own transition test)
 * creates that brief. Serial: later tests consume earlier ones' state.
 */
test.describe.serial("scorer", () => {
  test("missing ids are a 400", async ({ request }) => {
    const st = await seedState();
    for (const data of [
      {},
      { clientId: "client-corebloom" },
      { billId: st.billId },
    ]) {
      const res = await request.post(`${API}/api/client-impact/scan`, { data });
      expect(res.status(), `POST /scan ${JSON.stringify(data)}`).toBe(400);
    }
  });

  test("unknown client is a 404", async ({ request }) => {
    const st = await seedState();
    const res = await request.post(`${API}/api/client-impact/scan`, {
      data: { clientId: "e2e-no-such-client", billId: st.billId },
    });
    expect(res.status()).toBe(404);
  });

  test("unknown bill is a 404", async ({ request }) => {
    const res = await request.post(`${API}/api/client-impact/scan`, {
      data: { clientId: "client-corebloom", billId: "e2e-no-such-bill" },
    });
    expect(res.status()).toBe(404);
  });

  test("keyless scan returns a band-only fallback view — no score key anywhere", async ({
    request,
  }) => {
    const st = await seedState();
    const res = await request.post(`${API}/api/client-impact/scan`, {
      data: { clientId: "client-corebloom", billId: st.billId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The numeric score is backend-only: deep-scan the WHOLE parsed payload.
    expectNoScoreAnywhere(body);

    expectScanViewShape(body.scan, "client-corebloom", st.billId);
    expect(body.scan.source, "keyless server must take the fallback path").toBe(
      "fallback",
    );
    expect(body.scan.hasBrief, "no brief exists for this pair yet").toBe(false);
    expect(body.scan.analysisId ?? null, "no brief ⇒ no analysisId").toBeNull();
  });

  test("the same pair scans deterministically (identical except scannedAt)", async ({
    request,
  }) => {
    const st = await seedState();
    const scanOnce = async () => {
      const res = await request.post(`${API}/api/client-impact/scan`, {
        data: { clientId: "client-corebloom", billId: st.billId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expectNoScoreAnywhere(body);
      return body.scan;
    };
    const first = await scanOnce();
    const second = await scanOnce();

    const { scannedAt: _t1, ...rest1 } = first;
    const { scannedAt: _t2, ...rest2 } = second;
    expect(rest2, "keyless scans must be deterministic minus scannedAt").toEqual(rest1);
  });

  test("a bill with zero approved changes scans band 'low' and says why", async ({
    request,
  }) => {
    const st = await seedState();
    // bill2 has a seeded delta but NO approvals record.
    const res = await request.post(`${API}/api/client-impact/scan`, {
      data: { clientId: "client-corebloom", billId: st.billId2 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expectNoScoreAnywhere(body);

    expectScanViewShape(body.scan, "client-corebloom", st.billId2);
    expect(body.scan.band).toBe("low");
    expect(body.scan.source).toBe("fallback");
    expect(
      body.scan.rationale,
      "the rationale must say there are no approved changes",
    ).toMatch(/no approved changes/i);
  });

  test("GET /scans lists the pair (hasBrief:false), ranked, band-only", async ({
    request,
  }) => {
    const st = await seedState();
    const res = await request.get(
      `${API}/api/client-impact/scans?billId=${st.billId}`,
    );
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expectNoScoreAnywhere(list);

    const mine = list.find((s: any) => s.clientId === "client-corebloom");
    expect(mine, "the scanned pair must appear in the bill's scan list").toBeTruthy();
    expectScanViewShape(mine, "client-corebloom", st.billId);
    expect(mine.hasBrief).toBe(false);

    // Sorted by the backend's hidden score, descending. The score itself is
    // unobservable by design — its band shadow must be non-increasing.
    for (let i = 1; i < list.length; i++) {
      expect(
        BAND_SEVERITY[list[i - 1].band],
        `scans[${i - 1}] (${list[i - 1].band}) must rank ≥ scans[${i}] (${list[i].band})`,
      ).toBeGreaterThanOrEqual(BAND_SEVERITY[list[i].band]);
    }
  });

  test("GET /scans without billId is a 400", async ({ request }) => {
    const res = await request.get(`${API}/api/client-impact/scans`);
    expect(res.status()).toBe(400);
  });

  test("after analyze, the pair's listing flips to hasBrief:true with the analysisId", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const st = await seedState();
    const analyzed = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId: "client-corebloom", billId: st.billId },
      timeout: 90_000,
    });
    expect(analyzed.status()).toBe(200);
    const { analysis } = await analyzed.json();

    const res = await request.get(
      `${API}/api/client-impact/scans?billId=${st.billId}`,
    );
    expect(res.status()).toBe(200);
    const list = await res.json();
    expectNoScoreAnywhere(list);

    const mine = list.find((s: any) => s.clientId === "client-corebloom");
    expect(mine).toBeTruthy();
    expect(mine.hasBrief, "an existing brief must surface without re-scanning").toBe(true);
    expect(mine.analysisId).toBe(analysis.id);
  });

  test("deleting a client cascades its scans out of /scans", async ({ request }) => {
    const st = await seedState();

    const created = await request.post(`${API}/api/clients`, {
      data: {
        name: "E2E Scan Client",
        industry: "Compliance testing",
        jurisdictions: ["Canada"],
        description: "Created by the e2e scorer specs — safe to delete.",
      },
    });
    expect(created.ok()).toBeTruthy();
    const tempId = (await created.json()).id;
    expect(tempId).toBeTruthy();

    const scanned = await request.post(`${API}/api/client-impact/scan`, {
      data: { clientId: tempId, billId: st.billId },
    });
    expect(scanned.status()).toBe(200);
    expectNoScoreAnywhere(await scanned.json());

    const before = await (
      await request.get(`${API}/api/client-impact/scans?billId=${st.billId}`)
    ).json();
    expect(
      before.some((s: any) => s.clientId === tempId),
      "the temp client's scan must be listed before the delete",
    ).toBe(true);

    const del = await request.delete(`${API}/api/clients/${tempId}`);
    expect(del.status()).toBe(200);

    const after = await (
      await request.get(`${API}/api/client-impact/scans?billId=${st.billId}`)
    ).json();
    expect(
      after.some((s: any) => s.clientId === tempId),
      "DELETE /api/clients/:id must cascade the client's scans",
    ).toBe(false);
    expect(
      after.some((s: any) => s.clientId === "client-corebloom"),
      "the cascade must be surgical — other clients' scans stay",
    ).toBe(true);
  });
});

test.describe("analyze", () => {
  test("empty body is a 400", async ({ request }) => {
    const res = await request.post(`${API}/api/client-impact/analyze`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test("unknown client is a 404", async ({ request }) => {
    const st = await seedState();
    const res = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId: "e2e-no-such-client", billId: st.billId },
    });
    expect(res.status()).toBe(404);
  });

  test("unknown bill is a 404", async ({ request }) => {
    const res = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId: "client-corebloom", billId: "e2e-no-such-bill" },
    });
    expect(res.status()).toBe(404);
  });

  test("keyless analyze returns a review-flagged analysis; by-pair retrieves it", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const st = await seedState();
    const res = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId: "client-corebloom", billId: st.billId },
      timeout: 90_000,
    });
    expect(res.status()).toBe(200);
    const { analysis, email } = await res.json();

    // Keys are blanked, so the deterministic fallback must flag human review.
    expect(analysis.humanReviewRequired).toBe(true);
    expect(analysis.clientId).toBe("client-corebloom");
    expect(analysis.billId).toBe(st.billId);
    expect(email).toBeTruthy();
    expect(email.simulated).toBe(true); // RESEND_API_KEY is blanked

    const byPair = await request.get(
      `${API}/api/client-impact/by-pair?clientId=client-corebloom&billId=${st.billId}`,
    );
    expect(byPair.status()).toBe(200);
    const latest = await byPair.json();
    expect(latest.id).toBe(analysis.id);
    expect(latest.clientId).toBe("client-corebloom");
    expect(latest.billId).toBe(st.billId);
  });
});

/**
 * The brief library — GET /api/client-impact/briefs, the stage-4 picker feed.
 *
 * ORDERING: this block is declared AFTER the scorer and analyze blocks — by
 * the time it runs (workers=1, declaration order) the suite has both SCANNED
 * (client-corebloom, bill1) — the scorer block — and ANALYZED that same pair
 * (the scorer transition test and the analyze block), so the index must list
 * the pair WITH its band joined from the scans store. It is declared BEFORE
 * the CRUD block so that block's temp-client analysis and orphan handling
 * can't interfere.
 */
test.describe("brief library", () => {
  test("GET /briefs lists the seeded bill with the corebloom entry — band joined, no score key anywhere", async ({
    request,
  }) => {
    const st = await seedState();
    const res = await request.get(`${API}/api/client-impact/briefs`);
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);

    // Same law as every scorer payload: the numeric score is backend-only —
    // deep-scan the WHOLE index.
    expectNoScoreAnywhere(list);

    const mine = list.find((b: any) => b.billId === st.billId);
    expect(mine, `seeded bill ${st.billId} missing from /briefs`).toBeTruthy();
    expect(mine).toMatchObject({
      billId: st.billId,
      billNumber: st.billNumber,
      title: st.title,
      status: st.status,
    });
    expect(mine.briefCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(mine.clients)).toBe(true);
    expect(mine.clients, "briefCount must equal the clients listed").toHaveLength(
      mine.briefCount,
    );
    expect(typeof mine.latestAt).toBe("string");
    expect(Number.isNaN(Date.parse(mine.latestAt)), "latestAt must parse").toBe(false);

    const entry = mine.clients.find((c: any) => c.clientId === "client-corebloom");
    expect(entry, "the analyzed corebloom pair must be listed").toBeTruthy();
    expect(typeof entry.name).toBe("string");
    expect(entry.name.length).toBeGreaterThan(0);
    expect(typeof entry.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(entry.createdAt)), "createdAt must parse").toBe(false);

    // analysisId must point at the LATEST brief for the pair — exactly what
    // by-pair serves, so the picker and the deep link land on the same brief.
    const byPair = await request.get(
      `${API}/api/client-impact/by-pair?clientId=client-corebloom&billId=${st.billId}`,
    );
    expect(byPair.status()).toBe(200);
    expect(entry.analysisId).toBe((await byPair.json()).id);

    // The scorer block scanned this exact pair earlier in this file, so the
    // band must be present (band iff a scan exists) — and band-only.
    expect(
      SCAN_BAND_VALUES as readonly string[],
      "scanned pair ⇒ the entry must carry a valid band",
    ).toContain(entry.band);
  });

  test("bills sort by latestAt desc — a fresh brief on another bill takes the top", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const st = await seedState();
    // bill2 is seeded with a delta but NO approvals: /analyze still answers —
    // the brief path doesn't require approvals, it falls back keylessly. That
    // gives the index a SECOND bill whose latest brief is strictly newer than
    // bill1's, making the sort observable. (Teardown cascades bill2's impacts.)
    const analyzed = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId: "client-corebloom", billId: st.billId2 },
      timeout: 90_000,
    });
    expect(analyzed.status()).toBe(200);

    const res = await request.get(`${API}/api/client-impact/briefs`);
    expect(res.status()).toBe(200);
    const list = await res.json();
    expectNoScoreAnywhere(list);

    const i1 = list.findIndex((b: any) => b.billId === st.billId);
    const i2 = list.findIndex((b: any) => b.billId === st.billId2);
    expect(i1, "bill1 must be in the index").toBeGreaterThanOrEqual(0);
    expect(i2, "bill2 must be in the index").toBeGreaterThanOrEqual(0);
    expect(i2, "bill2's brief is newer — it must rank above bill1").toBeLessThan(i1);

    // The whole list must be non-increasing on latestAt (ISO strings compare
    // lexicographically).
    for (let i = 1; i < list.length; i++) {
      expect(
        list[i - 1].latestAt.localeCompare(list[i].latestAt),
        `briefs[${i - 1}].latestAt (${list[i - 1].latestAt}) must be ≥ briefs[${i}].latestAt (${list[i].latestAt})`,
      ).toBeGreaterThanOrEqual(0);
    }

    // The scorer block scanned corebloom×bill2 too (the zero-approvals test),
    // so bill2's entry must carry that deterministic 'low' band.
    const e2 = list[i2].clients.find((c: any) => c.clientId === "client-corebloom");
    expect(e2, "corebloom must be listed under bill2").toBeTruthy();
    expect(e2.band, "band must join from the pair's stored scan").toBe("low");
  });

  test("analyze accepts counsel guidance — keyless still 200, guidance never persisted", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const st = await seedState();
    const res = await request.post(`${API}/api/client-impact/analyze`, {
      data: {
        clientId: "client-corebloom",
        billId: st.billId,
        guidance: "focus on labeling",
      },
      timeout: 90_000,
    });
    expect(res.status()).toBe(200);
    const { analysis } = await res.json();
    expect(analysis.clientId).toBe("client-corebloom");
    expect(analysis.billId).toBe(st.billId);
    expect(analysis.humanReviewRequired, "keyless fallback must flag review").toBe(true);
    // Guidance is a transient generation input, never an analysis field.
    expect(analysis).not.toHaveProperty("guidance");

    // The index is latest-wins per pair: the corebloom entry now points at the
    // guidance-driven regen.
    const briefs = await request.get(`${API}/api/client-impact/briefs`);
    expect(briefs.status()).toBe(200);
    const after = await briefs.json();
    expectNoScoreAnywhere(after);
    const entry = after
      .find((b: any) => b.billId === st.billId)
      ?.clients.find((c: any) => c.clientId === "client-corebloom");
    expect(entry?.analysisId, "the index must follow the newest brief").toBe(analysis.id);
  });
});

test.describe.serial("clients CRUD + cascade", () => {
  let clientId = "";

  test("POST creates 'E2E Temp Client'", async ({ request }) => {
    const res = await request.post(`${API}/api/clients`, {
      data: {
        name: "E2E Temp Client",
        industry: "Compliance testing",
        jurisdictions: ["Canada"],
        description: "Created by the e2e suite — safe to delete.",
      },
    });
    expect(res.ok()).toBeTruthy();
    const client = await res.json();
    expect(client.id).toBeTruthy();
    expect(client.name).toBe("E2E Temp Client");
    clientId = client.id;
  });

  test("PUT renames it (partial update) and GET reflects the change", async ({
    request,
  }) => {
    expect(clientId).toBeTruthy();
    const res = await request.put(`${API}/api/clients/${clientId}`, {
      data: { name: "E2E Temp Client (renamed)" },
    });
    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.id).toBe(clientId);
    expect(updated.name).toBe("E2E Temp Client (renamed)");
    // partial update must not wipe other fields
    expect(updated.industry).toBe("Compliance testing");

    const got = await request.get(`${API}/api/clients/${clientId}`);
    expect(got.status()).toBe(200);
    expect((await got.json()).name).toBe("E2E Temp Client (renamed)");
  });

  test("PUT with an empty name is a 400", async ({ request }) => {
    expect(clientId).toBeTruthy();
    const res = await request.put(`${API}/api/clients/${clientId}`, {
      data: { name: "   " },
    });
    expect(res.status()).toBe(400);
  });

  test("PUT on an unknown client is a 404", async ({ request }) => {
    const res = await request.put(`${API}/api/clients/e2e-no-such-client`, {
      data: { name: "E2E Ghost" },
    });
    expect(res.status()).toBe(404);
  });

  test("DELETE removes the client and cascade-deletes its analyses", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    expect(clientId).toBeTruthy();
    const st = await seedState();

    // Give the client an analysis so the cascade is observable.
    const analyzed = await request.post(`${API}/api/client-impact/analyze`, {
      data: { clientId, billId: st.billId },
      timeout: 90_000,
    });
    expect(analyzed.status()).toBe(200);
    const before = await request.get(
      `${API}/api/client-impact/by-pair?clientId=${clientId}&billId=${st.billId}`,
    );
    expect(before.status()).toBe(200);

    const del = await request.delete(`${API}/api/clients/${clientId}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toMatchObject({ ok: true });

    const gone = await request.get(`${API}/api/clients/${clientId}`);
    expect(gone.status()).toBe(404);

    const orphan = await request.get(
      `${API}/api/client-impact/by-pair?clientId=${clientId}&billId=${st.billId}`,
    );
    expect(orphan.status(), "analyses must be cascade-deleted with the client").toBe(404);
  });

  test("DELETE on an unknown client is a 404", async ({ request }) => {
    const res = await request.delete(`${API}/api/clients/e2e-no-such-client`);
    expect(res.status()).toBe(404);
  });
});
