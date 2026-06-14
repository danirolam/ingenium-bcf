/**
 * Counsel-approval workflow + answerable Lawyer Review (commit 3ed4cf2) — the
 * gate between an AI-generated brief and anything leaving the building.
 *
 * Contract under test (ClientImpactAnalysis.tsx + POST /:id/save, which
 * repurposes the stored `saved` flag):
 *
 *  - A fresh keyless brief is UNAPPROVED: "Needs review" badge, `approve-brief`
 *    enabled ("Approve & generate email"), and the two export actions — Download
 *    brief + Email lawyer — DISABLED. Unapproved AI output cannot be sent or
 *    exported. The client email draft is deferred to approval.
 *  - Approving flips the gate: `approved-badge` ("Counsel approved") replaces
 *    the review badge, Download/Email enable, the button reads "Approved" and
 *    disables, and the /brief library tags the entry `brief-tag-approved`.
 *  - Answerable review: each verification question carries a
 *    `review-answer-input` textarea; `regen-with-answers` is enabled only when
 *    ≥1 answer is non-empty. Clicking it regenerates through the SAME transient
 *    guidance channel (verbatim Q/A pairs) and loads a NEW, UNAPPROVED version:
 *    approval is per-version, so the gate re-engages — badge, export locks and
 *    the /brief tag all revert, and the typed answers clear.
 *
 * ORDERING: runs alphabetically after api.spec.ts (workers=1), which leaves
 * the corebloom×bill1 pair's LATEST brief unapproved (its /save test approves
 * the bill2 pair instead, on purpose). The beforeAll guard keeps this spec
 * self-sufficient: it creates the brief when missing and regenerates when a
 * stray state left the latest version approved — either way the page below
 * opens on an unapproved version. Keyless fallback briefs always set
 * humanReviewRequired, so the Lawyer review section (and its answer inputs)
 * is guaranteed to render.
 */
import { test, expect } from "@playwright/test";
import { API, seedState, waitForApiReady } from "./helpers";

const CLIENT_ID = "client-corebloom";

test.beforeAll(async () => {
  await waitForApiReady();
  const st = await seedState();
  const pair = await fetch(
    `${API}/api/client-impact/by-pair?clientId=${CLIENT_ID}&billId=${st.billId}`,
  );
  let needFresh = pair.status === 404;
  if (!needFresh) {
    // Approval is per-version: if some earlier run left the latest version
    // approved, regenerate so the gate starts engaged.
    const latest = await pair.json();
    needFresh = latest.saved === true;
  }
  if (needFresh) {
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

test("approval gates export; answered review regenerates a new unapproved version and the gate re-engages", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const st = await seedState();

  await page.goto(`/clients/${CLIENT_ID}/bills/${st.billId}`);
  await expect(page.locator("h1")).toContainText("Client Brief", { timeout: 30_000 });

  const approve = page.getByTestId("approve-brief");
  const download = page.getByRole("button", { name: "Download brief" });
  const email = page.getByRole("button", { name: "Email lawyer" });
  const approvedBadge = page.getByTestId("approved-badge");
  const answers = page.getByTestId("review-answer-input");
  const regenWithAnswers = page.getByTestId("regen-with-answers");

  // ── Unapproved: review badge up, approve armed, exports locked.
  await expect(page.getByText("Needs review").first()).toBeVisible();
  await expect(approvedBadge).toHaveCount(0);
  await expect(approve).toBeEnabled();
  await expect(approve).toContainText("Approve & generate email");
  await expect(download, "unapproved briefs must not download").toBeDisabled();
  await expect(email, "unapproved briefs must not be emailed").toBeDisabled();
  // The client email draft is deferred: pre-approval the section header shows
  // the pending placeholder, not a draft.
  await expect(
    page.getByText("Generated when you approve the brief"),
    "email draft is deferred until approval",
  ).toBeVisible();

  // Answerable review renders with the brief — and with every answer box
  // empty, regen-with-answers must be disabled.
  await expect(answers.first()).toBeVisible();
  await expect(
    regenWithAnswers,
    "no non-empty answer ⇒ regen-with-answers stays disabled",
  ).toBeDisabled();

  // ── Approve: badge swaps, exports unlock, the button settles "Approved".
  await approve.click();
  await expect(approvedBadge).toBeVisible();
  await expect(approvedBadge).toContainText("Counsel approved");
  await expect(page.getByText("Needs review")).toHaveCount(0);
  await expect(download).toBeEnabled();
  await expect(email).toBeEnabled();
  await expect(approve).toBeDisabled();
  await expect(approve).toContainText("Approved");
  // Approving GENERATED the client email draft — the placeholder is replaced.
  await expect(
    page.getByText("Generated when you approve the brief"),
    "approval replaces the email placeholder with the generated draft",
  ).toHaveCount(0);

  // ── The library reflects the approval.
  await page.goto("/brief");
  const entry = page.locator(
    `[data-testid="brief-entry"][data-bill-id="${st.billId}"][data-client-id="${CLIENT_ID}"]`,
  );
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(entry.getByTestId("brief-tag-approved")).toBeVisible();
  await expect(entry.getByTestId("brief-tag-review")).toHaveCount(0);

  // ── Back on the brief page: answer the FIRST verification question.
  await page.goto(`/clients/${CLIENT_ID}/bills/${st.billId}`);
  await expect(approvedBadge).toBeVisible({ timeout: 30_000 });
  await expect(answers.first()).toBeVisible();
  await expect(regenWithAnswers).toBeDisabled(); // still no answers typed
  await answers
    .first()
    .fill("Yes — confirmed with the client's ops team; they rely on that provision today.");
  await expect(
    regenWithAnswers,
    "one non-empty answer must arm regen-with-answers",
  ).toBeEnabled();
  await regenWithAnswers.click();

  // ── Settles into a NEW, UNAPPROVED version (keyless fallback is fast; the
  // generous timeout is for slow machines). The gate re-engages everywhere.
  await expect(page.getByText("Needs review").first()).toBeVisible({
    timeout: 120_000,
  });
  await expect(approvedBadge).toHaveCount(0);
  await expect(download, "regeneration must re-lock the download").toBeDisabled();
  await expect(email, "regeneration must re-lock the email").toBeDisabled();
  await expect(approve).toBeEnabled();
  await expect(approve).toContainText("Approve & generate email");
  // The regenerated version's email is deferred again — placeholder returns.
  await expect(
    page.getByText("Generated when you approve the brief"),
    "regeneration defers the email again",
  ).toBeVisible();
  // The submitted answers cleared with the new version — button disarmed again.
  await expect(answers.first()).toHaveValue("");
  await expect(regenWithAnswers).toBeDisabled();

  // ── And the library tag reverts.
  await page.goto("/brief");
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(entry.getByTestId("brief-tag-review")).toBeVisible();
  await expect(entry.getByTestId("brief-tag-approved")).toHaveCount(0);
});
