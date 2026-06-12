/**
 * Stage-3 -> stage-4 happy path: pick the seeded ready bill, scan every
 * client, open a brief, navigate back.
 * Awaits Phase 2C (frontend testids); the scan itself runs on the keyless
 * fallback, so "done" should arrive fast — timeouts are generous anyway.
 */
import { test, expect } from "@playwright/test";
import { seedState, setAllClientCheckboxes, waitForApiReady } from "./helpers";

test("scan all clients against the seeded bill, open a brief, come back", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const st = await seedState();
  await waitForApiReady();

  // Stage 3: select the seeded ready bill. (Bounded visibility check first so
  // a missing frontend fails fast instead of eating the whole test timeout.)
  await page.goto("/clients");
  const card = page.locator(
    `[data-testid="ready-bill-card"][data-bill-id="${st.billId}"]`,
  );
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.getByTestId("approved-summary")).toBeVisible();

  // Select every client. Exercise the select-all control first; it toggles,
  // so settle the exact state checkbox-by-checkbox afterwards.
  await page.getByTestId("select-all-clients").click();
  await setAllClientCheckboxes(page, true);

  const runScan = page.getByTestId("run-scan");
  await expect(runScan).toBeEnabled();
  await runScan.click();

  // Every scan row must reach status "done".
  const rows = page.getByTestId("scan-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(3); // at least the three demo clients
  for (let i = 0; i < rowCount; i++) {
    await expect(rows.nth(i).getByTestId("scan-status")).toHaveText("done", {
      timeout: 120_000,
    });
  }

  // Stage 4: open the first brief.
  await rows.first().getByTestId("view-brief").click();
  await expect(page).toHaveURL(/\/clients\/[^/]+\/bills\/[^/]+/);
  await expect(page.locator("h1")).toContainText("Client Brief");
  await expect(page.getByText("Summary", { exact: true }).first()).toBeVisible();
  // Keyless fallback analyses always require human review.
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(page.getByText("Lawyer review").first()).toBeVisible();

  // Back returns to the scanner.
  await page.goBack();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByTestId("run-scan")).toBeVisible();
});
