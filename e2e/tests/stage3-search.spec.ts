/**
 * Stage-3 (Client scan) search + sort additions:
 *  - the client picker has a search box and is ordered A→Z;
 *  - the Ready-to-scan list has a search box (keeps newest-first).
 * Keyless; relies on the seeded/demo clients + the seeded approved bill.
 */
import { test, expect } from "@playwright/test";
import { seedState, waitForApiReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await waitForApiReady();
  await page.goto("/clients");
});

test("the client picker is searchable and ordered alphabetically", async ({
  page,
}) => {
  await expect(page.getByTestId("client-list")).toBeVisible();
  await expect(page.getByTestId("client-search")).toBeVisible();

  const names = (
    await page.locator('[data-testid="client-row"] .nm').allInnerTexts()
  ).map((s) => s.trim());
  expect(names.length).toBeGreaterThan(1);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  expect(names).toEqual(sorted);
});

test("typing a name narrows the client list", async ({ page }) => {
  await page.getByTestId("client-search").fill("Aurelia");
  const rows = page.getByTestId("client-row");
  await expect(rows.first()).toBeVisible();
  const names = (await rows.locator(".nm").allInnerTexts()).map((s) =>
    s.trim().toLowerCase(),
  );
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toContain("aurelia");
});

test("the Ready-to-scan list is searchable", async ({ page }) => {
  const st = await seedState();
  await expect(page.getByTestId("ready-bill-search")).toBeVisible();

  const card = page.locator(
    `[data-testid="ready-bill-card"][data-bill-id="${st.billId}"]`,
  );
  await expect(card).toBeVisible();

  // A gibberish query clears the grid…
  await page.getByTestId("ready-bill-search").fill("zzz-no-such-bill-zzz");
  await expect(page.getByTestId("ready-bill-card")).toHaveCount(0);

  // …and the seeded bill number narrows back to it.
  await page.getByTestId("ready-bill-search").fill(st.billNumber);
  await expect(card).toBeVisible();
});
