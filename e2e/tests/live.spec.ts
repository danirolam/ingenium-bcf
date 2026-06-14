/**
 * Opt-in live test (@live): exercises the REAL AI path, so it needs keys.
 *
 * How to run:
 *   1. In one terminal at the repo root, run YOUR OWN dev server with the
 *      real .env keys:  npm run dev
 *   2. In another:      cd e2e && npm run test:live
 *
 * With RUN_LIVE=1 the Playwright config manages NO webServer — this spec
 * talks straight to your server on :8787 (globalSetup still seeds the bill).
 */
import { test, expect } from "@playwright/test";
import { seedState } from "./helpers";

test.describe("live AI pipeline @live", () => {
  test.skip(
    !process.env.RUN_LIVE,
    "Live spec — run with `npm run test:live` while your own keyed dev server is up.",
  );

  test("analyze returns a real, non-fallback analysis @live", async ({ playwright }) => {
    test.setTimeout(300_000);
    const st = await seedState();
    const api = await playwright.request.newContext({
      baseURL: "http://localhost:8787",
    });
    try {
      const health = await api.get("/api/health").catch(() => null);
      expect(
        health?.ok(),
        "no dev server on :8787 — start `npm run dev` at the repo root first",
      ).toBeTruthy();

      const res = await api.post("/api/client-impact/analyze", {
        data: { clientId: "client-corebloom", billId: st.billId },
        timeout: 240_000,
      });
      expect(res.status()).toBe(200);
      const { analysis } = await res.json();

      // Non-fallback: the keyless path stamps a synthesized-fallback marker
      // into humanReviewReason; a real AI analysis must not carry one.
      expect(String(analysis.humanReviewReason ?? "")).not.toMatch(
        /synthesized|keyless|fallback|no GEMINI|no ANTHROPIC|no AI/i,
      );
      // A real pass grounds itself in the client's documents.
      expect((analysis.relevantClientText ?? []).length).toBeGreaterThan(0);
      expect(analysis.clientId).toBe("client-corebloom");
      expect(analysis.billId).toBe(st.billId);
    } finally {
      await api.dispose();
    }
  });
});
