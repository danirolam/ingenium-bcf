/**
 * Stage-4 brief library (`/brief`, top-nav "Client brief") — the FLAT,
 * filterable list that replaced the bill→client drill-down (commit 3ed4cf2) —
 * plus the regen-with-guidance panel on the brief page.
 *
 * ORDERING: this file runs alphabetically after api.spec.ts and
 * approval.spec.ts (workers=1), which leave briefs for (client-corebloom,
 * seeded bill 1) and (client-corebloom, seeded bill 2) behind. Assertions are
 * CONTAINMENT-only (demo-fixture briefs may coexist in the index) and anchor
 * on the SEEDED bill id from seedState(), never on demo data. The beforeAll
 * guard recreates the corebloom×bill1 brief keylessly if this spec is run
 * alone, so it stays self-sufficient; either way the pair is
 * seeded-bill-scoped and the global teardown cascade cleans it.
 *
 * Selector contract (frontend acceptance): /brief renders `brief-entry-list`
 * holding `brief-entry` rows (`data-analysis-id` / `data-bill-id` /
 * `data-client-id`) in chronological order (newest first — the server's
 * /briefs order, preserved by the client-side filters), or `briefs-empty`
 * when no briefs exist. Every row carries EXACTLY ONE of `brief-tag-approved`
 * ("Approved") | `brief-tag-review` ("Needs review"), plus an optional band
 * chip. Two native selects — `brief-filter-bill` and `brief-filter-client`
 * (option value = the id, "" = all) — AND-combine. Clicking a row opens the
 * pair's brief page at /clients/:clientId/bills/:billId (h1 "Client Brief").
 * REMOVED with the drill-down: `brief-bill-list`, `brief-bill-card`,
 * `brief-client-list`, `brief-client-card`, `brief-back`.
 *
 * On the brief page, `regen-toggle` (collapsed affordance) reveals
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

test("flat library: chronological tagged rows; bill + client filters AND-combine, reset restores; row click opens the brief", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const st = await seedState();

  // The server's index is the expected DOM content AND order (nothing mutates
  // the store between this fetch and the page's own — workers=1).
  const apiIndex: any[] = await (
    await fetch(`${API}/api/client-impact/briefs`)
  ).json();
  expect(apiIndex.length).toBeGreaterThanOrEqual(1);

  await page.goto("/brief");
  await expect(page.getByTestId("brief-entry-list")).toBeVisible({ timeout: 30_000 });
  // Briefs exist, so the empty state must not show.
  await expect(page.getByTestId("briefs-empty")).toHaveCount(0);
  // The drill-down era is over — none of its testids may render.
  for (const gone of [
    "brief-bill-list",
    "brief-bill-card",
    "brief-client-list",
    "brief-client-card",
    "brief-back",
  ]) {
    await expect(page.getByTestId(gone), `${gone} was removed with the drill-down`).toHaveCount(0);
  }

  // One row per index entry, in the SERVER's chronological order (the flat
  // list renders the index as served — createdAt desc).
  const rows = page.getByTestId("brief-entry");
  await expect(rows).toHaveCount(apiIndex.length);
  const domIds = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-analysis-id")),
  );
  expect(domIds, "rows must render in the index's chronological order").toEqual(
    apiIndex.map((e) => e.analysisId),
  );

  // Tag law: every row carries EXACTLY ONE of Approved | Needs review.
  for (let i = 0; i < apiIndex.length; i++) {
    const row = rows.nth(i);
    const approved = await row.getByTestId("brief-tag-approved").count();
    const review = await row.getByTestId("brief-tag-review").count();
    expect(
      approved + review,
      `row ${i} (${domIds[i]}) must carry exactly one tag, got approved=${approved} review=${review}`,
    ).toBe(1);
  }

  // The seeded pair's row is present (containment — demo entries coexist).
  const seededRow = page.locator(
    `[data-testid="brief-entry"][data-bill-id="${st.billId}"][data-client-id="${CLIENT_ID}"]`,
  );
  await expect(seededRow).toHaveCount(1);
  await expect(seededRow).toContainText(st.billNumber);

  // ── Bill filter: only the seeded bill's entries remain. (The negative
  // locators auto-retry, so the count reads below see the settled DOM.)
  const offBill = page.locator(
    `[data-testid="brief-entry"]:not([data-bill-id="${st.billId}"])`,
  );
  const offClient = page.locator(
    `[data-testid="brief-entry"]:not([data-client-id="${CLIENT_ID}"])`,
  );
  await page.getByTestId("brief-filter-bill").selectOption(st.billId);
  await expect(offBill, "the bill filter must hide every other bill's entries").toHaveCount(0);
  await expect(seededRow).toHaveCount(1);
  expect(await rows.count()).toBeGreaterThanOrEqual(1);

  // ── AND-combination: ALSO select the client — rows must match BOTH.
  await page.getByTestId("brief-filter-client").selectOption(CLIENT_ID);
  await expect(offClient, "the client filter must AND with the bill filter").toHaveCount(0);
  await expect(offBill).toHaveCount(0);
  await expect(seededRow).toHaveCount(1);
  expect(await rows.count()).toBeGreaterThanOrEqual(1);

  // ── Reset both filters ("" = all): the full chronological list returns.
  await page.getByTestId("brief-filter-bill").selectOption("");
  await page.getByTestId("brief-filter-client").selectOption("");
  await expect(rows).toHaveCount(apiIndex.length);
  expect(
    await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-analysis-id"))),
    "resetting the filters must restore the full ordered list",
  ).toEqual(apiIndex.map((e) => e.analysisId));

  // ── Clicking the seeded entry opens the pair's brief page.
  await seededRow.click();
  await expect(page).toHaveURL(
    new RegExp(`/clients/${CLIENT_ID}/bills/${escapeRegex(st.billId)}`),
  );
  await expect(page.locator("h1")).toContainText("Client Brief");
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
