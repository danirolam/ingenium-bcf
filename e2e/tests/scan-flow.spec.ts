/**
 * Two-phase stage-3 flow (Phase 2C frontend, two-agent split):
 *
 *   1. Run scan  → every selected client gets a fast impact BAND on the
 *      scoreboard (scan-status settles at "scored", scan-band[data-band]).
 *   2. Rationale → per-row accordion (scan-rationale-toggle / scan-rationale):
 *      at most ONE rationale is visible at a time.
 *   3. Analyze   → the per-row analyze-client button produces the full brief;
 *      view-brief appears on that row, opens stage 4, back returns here.
 *   4. Persist   → scans are stored latest-wins: a reload + re-selecting the
 *      bill restores the scoreboard, bands included, and the analyzed row
 *      still offers view-brief.
 *
 * Everything runs on the keyless fallback (deterministic heuristic scores,
 * synthesized briefs), so "scored" and the brief arrive fast — the generous
 * timeouts are for slow machines, not the pipeline.
 */
import { test, expect } from "@playwright/test";
import {
  expectAllRowsScored,
  seedState,
  setAllClientCheckboxes,
  visibleRationales,
  waitForApiReady,
} from "./helpers";

test("two-phase scan: band scoreboard, rationale accordion, per-row analyze → brief → back, persistence", async ({
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
  const clientCount = await page.getByTestId("client-checkbox").count();
  expect(clientCount).toBeGreaterThanOrEqual(3); // at least the three demo clients

  const runScan = page.getByTestId("run-scan");
  await expect(runScan).toBeEnabled();
  await runScan.click();

  // ── Phase 1: the scoreboard. One row per selected client; every row settles
  // at "scored" (the full status set is queued|scoring|scored|failed) and
  // carries a band. The keyless heuristic never fails, so no scan-retry, and
  // every row offers the per-row analyze button.
  await expectAllRowsScored(page, clientCount);
  // The post-loop ranking refresh can reorder rows a beat after the last row
  // turns "scored". setScanning(false) is sequenced strictly after that merge,
  // so a re-enabled Run button proves the row order is FINAL — required before
  // any positional locator below.
  await expect(runScan).toBeEnabled();
  const rows = page.getByTestId("scan-row");
  for (let i = 0; i < clientCount; i++) {
    await expect(rows.nth(i).getByTestId("scan-retry")).toHaveCount(0);
    await expect(rows.nth(i).getByTestId("analyze-client")).toBeVisible();
  }

  // ── Phase 1b: the rationale accordion — at most ONE rationale visible.
  // Pin the two probe rows by client id (stable across any re-render), not by
  // position.
  const idA = await rows.nth(0).getAttribute("data-client-id");
  const idB = await rows.nth(1).getAttribute("data-client-id");
  expect(idA && idB && idA !== idB).toBeTruthy();
  const rowA = page.locator(`[data-testid="scan-row"][data-client-id="${idA}"]`);
  const rowB = page.locator(`[data-testid="scan-row"][data-client-id="${idB}"]`);

  await rowA.getByTestId("scan-rationale-toggle").click();
  await expect(rowA.getByTestId("scan-rationale")).toBeVisible();
  await expect(rowA.getByTestId("scan-rationale")).not.toBeEmpty();
  await expect(visibleRationales(page)).toHaveCount(1);

  await rowB.getByTestId("scan-rationale-toggle").click();
  await expect(rowB.getByTestId("scan-rationale")).toBeVisible();
  await expect(rowA.getByTestId("scan-rationale")).toBeHidden(); // accordion: A closed by B
  await expect(visibleRationales(page)).toHaveCount(1);

  await rowB.getByTestId("scan-rationale-toggle").click(); // toggle B shut again
  await expect(visibleRationales(page)).toHaveCount(0);

  // ── Phase 2: analyze ONE row. Prefer a row with no brief yet (api.spec may
  // already have analyzed a demo client against this bill) so the click is
  // what causes view-brief to appear.
  let target = rows.first();
  for (let i = 0; i < clientCount; i++) {
    if ((await rows.nth(i).getByTestId("view-brief").count()) === 0) {
      target = rows.nth(i);
      break;
    }
  }
  const targetClientId = await target.getAttribute("data-client-id");
  expect(targetClientId).toBeTruthy();

  await target.getByTestId("analyze-client").click();
  const viewBrief = target.getByTestId("view-brief");
  await expect(viewBrief).toBeVisible({ timeout: 120_000 }); // keyless brief is fast
  await viewBrief.click();

  // Stage 4: the brief page (selectors as shipped by ClientImpactAnalysis.tsx).
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

  // ── Phase 3: persistence. A fresh document + re-selecting the bill restores
  // the scoreboard from the store (latest-wins): same rows, bands intact, and
  // the analyzed pair still links to its brief — no re-scan, no re-analyze.
  await page.reload();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.getByTestId("approved-summary")).toBeVisible();

  await expectAllRowsScored(page, clientCount);
  const analyzedRow = page.locator(
    `[data-testid="scan-row"][data-client-id="${targetClientId}"]`,
  );
  await expect(analyzedRow).toHaveCount(1);
  await expect(analyzedRow.getByTestId("view-brief")).toBeVisible();
});
