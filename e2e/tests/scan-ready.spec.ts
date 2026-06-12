/**
 * Stage-3 UI: the scan-ready list and approved-changes summary.
 */
import { test, expect } from "@playwright/test";
import { SEED_ACT, SEED_APPROVED_KEYS } from "../seed";
import { seedState, waitForApiReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await waitForApiReady();
  await page.goto("/clients");
});

test("the ready list shows the seeded bill card with its approved count", async ({
  page,
}) => {
  const st = await seedState();
  await expect(page.getByTestId("ready-bill-list")).toBeVisible();

  const card = page.locator(
    `[data-testid="ready-bill-card"][data-bill-id="${st.billId}"]`,
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText(st.billNumber);
  await expect(card).toContainText("3"); // approved-op count
});

test("a bill with a delta but no approvals never gets a ready card", async ({
  page,
}) => {
  const st = await seedState();
  await expect(page.getByTestId("ready-bill-list")).toBeVisible();
  await expect(
    page.locator(`[data-testid="ready-bill-card"][data-bill-id="${st.billId2}"]`),
  ).toHaveCount(0);
});

test("selecting the ready bill shows the approved-changes summary", async ({
  page,
}) => {
  const st = await seedState();
  await page
    .locator(`[data-testid="ready-bill-card"][data-bill-id="${st.billId}"]`)
    .click();

  await expect(page.getByTestId("approved-summary")).toBeVisible();

  const act = page.locator(
    `[data-testid="approved-act"][data-slug="${SEED_ACT.slug}"]`,
  );
  await expect(act).toBeVisible();
  await expect(act).toContainText(SEED_ACT.title);

  await expect(page.getByTestId("approved-op")).toHaveCount(3);
  for (const key of SEED_APPROVED_KEYS) {
    await expect(
      page.locator(`[data-testid="approved-op"][data-key="${key}"]`),
    ).toBeVisible();
  }
});

test("the browse-all toggle reveals the full bill grid", async ({ page }) => {
  await page.getByTestId("browse-all-toggle").click();
  await expect(page.getByTestId("browse-bill-grid")).toBeVisible();
});
