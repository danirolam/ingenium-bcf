/**
 * Request-level contracts for the stage 3-4 backend (Phase 1A).
 *
 * Passing TODAY (current server): analyze validation (400/404), keyless
 * analyze + by-pair, client create.
 * Awaiting Phase 1A: /api/client-impact/scan-ready (+/:billId), PUT/DELETE
 * /api/clients/:id and the analyses cascade.
 */
import { test, expect } from "@playwright/test";
import { SEED_ACT, SEED_APPROVED_KEYS } from "../seed";
import { API, seedState, waitForApiReady } from "./helpers";

test.beforeAll(async () => {
  await waitForApiReady();
});

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
