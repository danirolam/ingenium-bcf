/**
 * Stage-2 Delta Library UI (the /delta landing).
 *
 * Uses the GLOBAL e2e seed (e2e/seed.ts) — NOT seed-demo.ts — which writes two
 * generated-delta records: the "ready" bill (all 3 ops approved → Approved tag)
 * and a second bill (delta, zero approvals → Needs-review tag). Keyless.
 *
 * Coordination note: this only drives the library (the !billId chooser). On
 * click-through we assert the URL only — the /bills/:id/delta comparator surface
 * is owned by a parallel agent and must not be coupled to here.
 */
import { test, expect } from "@playwright/test";
import { seedState, waitForApiReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await waitForApiReady();
  await page.goto("/delta");
});

test("lists generated deltas with the Category/Status filters + search", async ({
  page,
}) => {
  await expect(page.getByTestId("delta-library")).toBeVisible();
  await expect(page.getByTestId("delta-filter-category")).toBeVisible();
  await expect(page.getByTestId("delta-filter-status")).toBeVisible();
  await expect(page.getByTestId("delta-search")).toBeVisible();

  const rows = page.getByTestId("delta-entry");
  await expect(rows.first()).toBeVisible();
  // Pagination caps the page at 16 rows.
  expect(await rows.count()).toBeLessThanOrEqual(16);
});

test("seeded deltas carry the right approved / needs-review tags", async ({
  page,
}) => {
  const st = await seedState();

  const approved = page.locator(
    `[data-testid="delta-entry"][data-bill-id="${st.billId}"]`,
  );
  await expect(approved).toBeVisible();
  await expect(approved.getByTestId("delta-tag-approved")).toBeVisible();

  const review = page.locator(
    `[data-testid="delta-entry"][data-bill-id="${st.billId2}"]`,
  );
  await expect(review).toBeVisible();
  await expect(review.getByTestId("delta-tag-review")).toContainText(
    "Needs review",
  );
});

test("search narrows to a bill, and a no-match shows the empty state", async ({
  page,
}) => {
  const st = await seedState();

  await page.getByTestId("delta-search").fill(st.billNumber);
  await expect(
    page.locator(`[data-testid="delta-entry"][data-bill-id="${st.billId}"]`),
  ).toBeVisible();

  await page.getByTestId("delta-search").fill("zzz-no-such-bill-zzz");
  await expect(page.getByTestId("delta-entry")).toHaveCount(0);
});

test("clicking a delta opens its review (URL only)", async ({ page }) => {
  const st = await seedState();
  await page
    .locator(`[data-testid="delta-entry"][data-bill-id="${st.billId}"]`)
    .click();
  await page.waitForURL(`**/bills/${st.billId}/delta`);
});

test("New delta opens the amending-bill picker and navigates", async ({ page }) => {
  await page.getByTestId("new-delta-btn").click();
  await expect(page.getByTestId("new-delta-modal")).toBeVisible();
  await expect(page.getByTestId("new-delta-search")).toBeVisible();

  const first = page.getByTestId("new-delta-item").first();
  await expect(first).toBeVisible();
  const billId = await first.getAttribute("data-bill-id");
  await first.click();
  await page.waitForURL(`**/bills/${billId}/delta`);
});
