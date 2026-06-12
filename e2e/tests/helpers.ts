/** Shared helpers for the spec files (not a spec — Playwright only collects *.spec.ts). */
import { expect, type Locator, type Page } from "@playwright/test";
import { readSeedState, type SeedState } from "../seed";

/** The Express API, hit directly (bypasses the Vite proxy). */
export const API = "http://localhost:8787";

/** Seeded fixture identity written by globalSetup. */
export async function seedState(): Promise<SeedState> {
  const state = await readSeedState();
  if (!state) {
    throw new Error(
      "e2e/.seed-state.json missing — globalSetup did not run (or teardown already ran).",
    );
  }
  return state;
}

/**
 * Wait until the API answers /api/health. The Playwright webServer only gates
 * on the Vite port (5173); the Express side of `npm run dev` can lag a moment.
 */
export async function waitForApiReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`API on ${API} did not become ready within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Drive every client-checkbox to the desired state.
 *
 * Contract notes (stage-3 frontend):
 *  - [data-testid="client-checkbox"] is the checkable element itself
 *    (an <input type="checkbox"> or [role="checkbox"]).
 *  - [data-testid="select-all-clients"] toggles all-selected <-> none-selected.
 * These helpers go checkbox-by-checkbox so they hold regardless of the
 * list's initial selection state.
 */
export async function setAllClientCheckboxes(page: Page, selected: boolean): Promise<void> {
  const boxes = page.getByTestId("client-checkbox");
  await expect(boxes.first()).toBeVisible();
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    await boxes.nth(i).setChecked(selected);
  }
}

// ── Two-phase scan (scorer) helpers ──────────────────────────────────────────

/** The only legal `data-band` values, ascending severity (mirrors SCAN_BANDS). */
export const SCAN_BAND_VALUES = ["low", "medium", "high", "critical"] as const;
export const SCAN_BAND_RE = /^(low|medium|high|critical)$/;

/**
 * Assert the scoreboard holds exactly `expectedCount` scan rows and that every
 * row settles at scan-status "scored" carrying a valid scan-band[data-band].
 * (The keyless heuristic is near-instant; the generous per-row timeout is for
 * slow CI machines, not the scorer.)
 */
export async function expectAllRowsScored(
  page: Page,
  expectedCount: number,
  timeoutMs = 120_000,
): Promise<void> {
  const rows = page.getByTestId("scan-row");
  await expect(rows).toHaveCount(expectedCount, { timeout: 30_000 });
  for (let i = 0; i < expectedCount; i++) {
    const row = rows.nth(i);
    await expect(row.getByTestId("scan-status")).toHaveText("scored", {
      timeout: timeoutMs,
    });
    const band = row.getByTestId("scan-band");
    await expect(band).toBeVisible();
    await expect(band).toHaveAttribute("data-band", SCAN_BAND_RE);
  }
}

/**
 * The rationale panels currently shown. The accordion law is "at most ONE
 * visible at a time"; `:visible` keeps the count honest whether a closed panel
 * is unmounted or merely CSS-hidden.
 */
export function visibleRationales(page: Page) {
  return page.locator('[data-testid="scan-rationale"]:visible');
}

/**
 * The single-action-slot law: a SCORED row renders EXACTLY ONE of
 * `analyze-client` | `view-brief` (`scan-retry` is reserved for failed rows,
 * so a scored row has zero). Waits for the slot to render, then returns which
 * action it holds.
 */
export async function expectSingleActionSlot(
  row: Locator,
): Promise<"analyze-client" | "view-brief"> {
  // Either action doubles as the render gate (auto-waits). If BOTH were
  // present, the strict-mode violation fails the test — as it should.
  await expect(
    row.getByTestId("analyze-client").or(row.getByTestId("view-brief")),
  ).toBeVisible();
  await expect(row.getByTestId("scan-retry")).toHaveCount(0);
  const analyze = await row.getByTestId("analyze-client").count();
  const view = await row.getByTestId("view-brief").count();
  expect(
    analyze + view,
    `a scored row must render exactly one slot action, got analyze-client=${analyze} view-brief=${view}`,
  ).toBe(1);
  return analyze === 1 ? "analyze-client" : "view-brief";
}
