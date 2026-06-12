/**
 * Stage-3 UI guard rails: run-scan must stay disabled until both a ready
 * bill and at least one client are selected.
 * Awaits Phase 2C (frontend testids).
 *
 * The "delta but zero approvals" case is covered at the API level in
 * api.spec.ts (seeded second bill absent from scan-ready) and in
 * scan-ready.spec.ts (no ready card) — it needs no UI flow of its own.
 */
import { test, expect } from "@playwright/test";
import { seedState, setAllClientCheckboxes, waitForApiReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await waitForApiReady();
  await page.goto("/clients");
});

test("run-scan is disabled while no bill is selected", async ({ page }) => {
  await expect(page.getByTestId("run-scan")).toBeDisabled();
});

test("run-scan is disabled when every client is deselected", async ({ page }) => {
  const st = await seedState();
  await page
    .locator(`[data-testid="ready-bill-card"][data-bill-id="${st.billId}"]`)
    .click();
  await expect(page.getByTestId("approved-summary")).toBeVisible();

  // Sanity: with all clients selected the scan is runnable...
  await setAllClientCheckboxes(page, true);
  await expect(page.getByTestId("run-scan")).toBeEnabled();

  // ...and with none selected it is not.
  await setAllClientCheckboxes(page, false);
  await expect(page.getByTestId("run-scan")).toBeDisabled();
});
