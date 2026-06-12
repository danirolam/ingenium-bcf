/** Shared helpers for the spec files (not a spec — Playwright only collects *.spec.ts). */
import { expect, type Page } from "@playwright/test";
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
