/**
 * Smoke — must pass TODAY, against the current main-line app.
 * Proves: webServer boot, env blanking, baseURL/proxy wiring, seed harness.
 */
import { test, expect } from "@playwright/test";
import { API, waitForApiReady } from "./helpers";

test.describe("smoke", () => {
  test("GET /api/health returns ok:true (direct on :8787)", async ({ request }) => {
    await waitForApiReady();
    const res = await request.get(`${API}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Canary for the env blanking: with GEMINI_API_KEY="" the server must
    // report AI integrations disabled (deterministic fallback mode).
    if (body.ai) expect(body.ai.enabled).toBe(false);
    if (body.email) expect(body.email.enabled).toBe(false);
  });

  test('the app renders at "/"', async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Federal bill intelligence/i);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});
