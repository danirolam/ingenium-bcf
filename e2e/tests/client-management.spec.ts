/**
 * Stage-3 UI: client CRUD through the modal.
 * Awaits Phase 2C (frontend testids). Backed by Phase 1A PUT/DELETE routes.
 */
import { test, expect } from "@playwright/test";
import { waitForApiReady } from "./helpers";

const NAME_V1 = "E2E Modal Client";
const NAME_V2 = "E2E Modal Client 2";

function rowNamed(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId("client-row").filter({ hasText: name });
}

test.describe.serial("client management modal", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApiReady();
    await page.goto("/clients");
    await expect(page.getByTestId("client-list")).toBeVisible();
  });

  test("new-client modal creates a client", async ({ page }) => {
    await page.getByTestId("new-client-button").click();
    await expect(page.getByTestId("client-modal")).toBeVisible();

    await page.getByTestId("client-name-input").fill(NAME_V1);
    await page.getByTestId("client-industry-input").fill("Compliance testing");
    await page.getByTestId("client-jurisdictions-input").fill("Canada");
    await page
      .getByTestId("client-description-input")
      .fill("Created by the e2e suite — safe to delete.");
    await page.getByTestId("client-tc-input").fill("E2E terms and conditions.");
    await page.getByTestId("client-policies-input").fill("E2E privacy policy.");
    await page.getByTestId("client-operations-input").fill("E2E operations notes.");

    await page.getByTestId("client-modal-save").click();
    await expect(page.getByTestId("client-modal")).toBeHidden();
    await expect(rowNamed(page, NAME_V1)).toHaveCount(1);
  });

  test("edit renames the client and changes its industry", async ({ page }) => {
    const row = rowNamed(page, NAME_V1);
    await expect(row).toHaveCount(1);
    await row.getByTestId("edit-client").click();
    await expect(page.getByTestId("client-modal")).toBeVisible();

    // The modal must come prefilled with the existing record.
    await expect(page.getByTestId("client-name-input")).toHaveValue(NAME_V1);

    await page.getByTestId("client-name-input").fill(NAME_V2);
    await page.getByTestId("client-industry-input").fill("Regulatory audit");
    await page.getByTestId("client-modal-save").click();
    await expect(page.getByTestId("client-modal")).toBeHidden();

    await expect(rowNamed(page, NAME_V2)).toHaveCount(1);
    const updated = rowNamed(page, NAME_V2);
    await expect(updated).toContainText("Regulatory audit");
  });

  test("the rename persisted (fresh page load)", async ({ page }) => {
    // beforeEach already re-navigated — this is a brand-new document.
    await expect(rowNamed(page, NAME_V2)).toHaveCount(1);
    await expect(rowNamed(page, NAME_V2)).toContainText("Regulatory audit");
  });

  test("delete asks for confirmation, then the client is gone for good", async ({
    page,
  }) => {
    const row = rowNamed(page, NAME_V2);
    await expect(row).toHaveCount(1);
    await row.getByTestId("delete-client").click();
    await page.getByTestId("confirm-delete-client").click();
    await expect(rowNamed(page, NAME_V2)).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("client-list")).toBeVisible();
    await expect(rowNamed(page, NAME_V2)).toHaveCount(0);
  });
});
