/**
 * Stage-4 brief library picker (`/brief`, top-nav "Client brief") + the
 * regen-with-guidance panel on the brief page.
 *
 * ORDERING: this file runs alphabetically after api.spec.ts (workers=1), which
 * leaves a brief for (client-corebloom, seeded bill 1) behind — the picker
 * must therefore list that pair. Assertions are CONTAINMENT-only (demo-fixture
 * briefs may coexist in the index) and anchor on the SEEDED bill id from
 * seedState(), never on demo data. The beforeAll guard recreates the brief
 * keylessly if this spec is run alone, so it stays self-sufficient; either
 * way the pair is seeded-bill-scoped and the global teardown cascade cleans it.
 *
 * Selector contract (frontend acceptance): /brief renders `brief-bill-list`
 * of `brief-bill-card[data-bill-id]` cards (`briefs-empty` when none) → click
 * → in-page step 2: `brief-back`, `brief-client-list`,
 * `brief-client-card[data-client-id]` (band chip when the pair was scanned)
 * → click → the existing brief page (/clients/:clientId/bills/:billId,
 * h1 "Client Brief"). There, `regen-toggle` (collapsed affordance) reveals
 * `regen-context-input` + `regen-brief`; on success the brief re-renders and
 * the panel collapses.
 */
import { test, expect } from "@playwright/test";
import { API, seedState, waitForApiReady } from "./helpers";

const CLIENT_ID = "client-corebloom";

/** Escape a literal for a RegExp (seeded bill ids are arbitrary strings). */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.beforeAll(async () => {
  await waitForApiReady();
  // api.spec.ts normally created the corebloom×bill1 brief earlier in the run;
  // recreate it via the same keyless flow when this spec runs alone.
  const st = await seedState();
  const pair = await fetch(
    `${API}/api/client-impact/by-pair?clientId=${CLIENT_ID}&billId=${st.billId}`,
  );
  if (pair.status === 404) {
    const res = await fetch(`${API}/api/client-impact/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT_ID, billId: st.billId }),
    });
    if (!res.ok) {
      throw new Error(
        `beforeAll fallback analyze failed: ${res.status} ${await res.text()}`,
      );
    }
  }
});

test("picker drill-down: bill card → client card → the pair's brief page; brief-back unwinds", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const st = await seedState();

  await page.goto("/brief");
  await expect(page.getByTestId("brief-bill-list")).toBeVisible({ timeout: 30_000 });
  // Briefs exist, so the empty state must not show.
  await expect(page.getByTestId("briefs-empty")).toBeHidden();

  // Step 1: the seeded bill is listed (containment — demo bills may coexist).
  const billCard = page.locator(
    `[data-testid="brief-bill-card"][data-bill-id="${st.billId}"]`,
  );
  await expect(billCard).toBeVisible();
  await expect(billCard).toContainText(st.billNumber);
  await billCard.click();

  // Step 2 (in-page): the bill's briefed clients, with the analyzed client.
  await expect(page.getByTestId("brief-client-list")).toBeVisible();
  const clientCard = page.locator(
    `[data-testid="brief-client-card"][data-client-id="${CLIENT_ID}"]`,
  );
  await expect(clientCard).toBeVisible();
  await clientCard.click();

  // Step 3: the existing brief page, for exactly the pair we drilled into.
  await expect(page).toHaveURL(
    new RegExp(`/clients/${CLIENT_ID}/bills/${escapeRegex(st.billId)}`),
  );
  await expect(page.locator("h1")).toContainText("Client Brief");

  // Round 2: drill in again and unwind with the picker's own back affordance.
  await page.goto("/brief");
  await expect(page.getByTestId("brief-bill-list")).toBeVisible();
  await billCard.click();
  await expect(page.getByTestId("brief-client-list")).toBeVisible();
  await page.getByTestId("brief-back").click();
  await expect(page.getByTestId("brief-bill-list")).toBeVisible();
  await expect(page.getByTestId("brief-client-list")).toBeHidden();
});

test("regen panel: collapsed toggle reveals the guidance input; regenerate re-renders and collapses", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const st = await seedState();

  // The analyzed pair's brief page, via its deep link.
  await page.goto(`/clients/${CLIENT_ID}/bills/${st.billId}`);
  await expect(page.locator("h1")).toContainText("Client Brief", { timeout: 30_000 });

  // Collapsed affordance first: no guidance textarea until the toggle opens it.
  const input = page.getByTestId("regen-context-input");
  await expect(page.getByTestId("regen-toggle")).toBeVisible();
  await expect(input).toBeHidden();

  await page.getByTestId("regen-toggle").click();
  await expect(input).toBeVisible();
  await input.fill("Focus on supplier obligations.");
  await page.getByTestId("regen-brief").click();

  // Settle: the keyless fallback regen is fast (the generous timeout is for
  // slow machines, not the pipeline). Success = the panel collapsed and the
  // brief page is still rendered.
  await expect(input).toBeHidden({ timeout: 120_000 });
  await expect(page.locator("h1")).toContainText("Client Brief");
});
