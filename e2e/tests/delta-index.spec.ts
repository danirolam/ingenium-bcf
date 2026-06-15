/**
 * Stage-2 Delta Library data contract: GET /api/provision-deltas.
 *
 * An isolated, read-only index of every bill that already has a GENERATED
 * provision delta (joins provisionDeltas.json ⨝ approvals.json ⨝ bills.json).
 * Deterministic + keyless — it summarizes the seeded fixtures, runs no AI.
 *
 * The global e2e seed (e2e/seed.ts) writes two delta records: the "ready" bill
 * (all 3 ops approved) and a second bill (delta, zero approvals) — so this
 * exercises both the op-count aggregation and the approved/needs-review split.
 */
import { test, expect } from "@playwright/test";
import { SEED_ACT, SECOND_ACT } from "../seed";
import { API, seedState, waitForApiReady } from "./helpers";

test.beforeEach(async () => {
  await waitForApiReady();
});

test("indexes generated deltas with op + approval counts", async ({ request }) => {
  const st = await seedState();
  const res = await request.get(`${API}/api/provision-deltas`);
  expect(res.ok()).toBeTruthy();
  const entries = (await res.json()) as Array<Record<string, any>>;
  expect(Array.isArray(entries)).toBe(true);

  // The fully-approved seeded bill.
  const e1 = entries.find((e) => e.billId === st.billId);
  expect(e1, "seeded approved bill should be indexed").toBeTruthy();
  expect(e1!.billNumber).toBe(st.billNumber);
  expect(e1!.actTitles).toContain(SEED_ACT.title);
  expect(e1!.opCount).toBe(3);
  expect(e1!.approvedOpCount).toBe(3); // seed approved all 3
  expect(e1!.summary).toEqual({ added: 1, changed: 1, repealed: 1 });

  // The second seeded bill has a delta but NO approvals.
  const e2 = entries.find((e) => e.billId === st.billId2);
  expect(e2, "seeded unapproved bill should still be indexed (a delta exists)").toBeTruthy();
  expect(e2!.actTitles).toContain(SECOND_ACT.title);
  expect(e2!.opCount).toBe(3);
  expect(e2!.approvedOpCount).toBe(0);
});

test("entries are newest-first by generatedAt", async ({ request }) => {
  const res = await request.get(`${API}/api/provision-deltas`);
  const entries = (await res.json()) as Array<{ generatedAt: string }>;
  const times = entries.map((e) => e.generatedAt);
  const sorted = [...times].sort((a, b) => String(b).localeCompare(String(a)));
  expect(times).toEqual(sorted);
});
