/**
 * Stage-3 UI guard rails: run-scan must stay disabled until both a ready
 * bill and at least one client are selected, and a non-ready bill must
 * route the user to stage 2 instead of scanning.
 *
 * The "delta but zero approvals" case is additionally covered at the API
 * level in api.spec.ts (seeded second bill absent from scan-ready).
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

test("selecting a non-ready bill shows stage-2 guidance and keeps run-scan disabled", async ({
  page,
}) => {
  const st = await seedState();

  // The second seeded bill has a delta but no approvals — find it through the
  // browse-all grid's search. Any title match is necessarily non-ready (only
  // bill 1 is scan-ready in the store), so first() is safe even if the same
  // title recurs across sessions.
  await page.getByTestId("browse-all-toggle").click();
  const grid = page.getByTestId("browse-bill-grid");
  await expect(grid).toBeVisible();
  await grid.getByRole("searchbox").fill(st.title2);
  await grid.locator(".lpg-card").first().click();

  await expect(page.getByTestId("stage2-guidance")).toBeVisible();
  await expect(page.getByTestId("run-scan")).toBeDisabled();
});
