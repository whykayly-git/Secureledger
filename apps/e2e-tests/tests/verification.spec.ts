import { test, expect, APIRequestContext } from "@playwright/test";
import { seedAccounts, seedJournalEntry, SeededAccounts } from "./helpers";

let accounts: SeededAccounts;
let checkpointCandidateEntryId: string;

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  accounts = await seedAccounts(request);
  // Seeded here (before any test runs) so the real checkpoint-worker has
  // the maximum head start to pick it up before the "sees Verified"
  // test below polls for it.
  checkpointCandidateEntryId = await seedJournalEntry(request, accounts, "E2E checkpoint candidate entry");
});

test.describe("Verification", () => {
  test("verifying a freshly-posted entry shows the honest 'pending' verdict", async ({ page, request }) => {
    const journalEntryId = await seedJournalEntry(request, accounts, "E2E pending verify entry");

    await page.goto("/verification");
    await page.getByPlaceholder("Record ID (journal entry or invoice)").fill(journalEntryId);
    await page.getByRole("button", { name: "Verify" }).click();

    // A record just posted has not been checkpointed yet — the UI must show
    // the honest "Pending checkpoint" state, not a false "Verified".
    await expect(page.getByText("Pending checkpoint")).toBeVisible();
  });

  test("verifying an unknown record id surfaces an error, not a false pass", async ({ page }) => {
    await page.goto("/verification");
    await page.getByPlaceholder("Record ID (journal entry or invoice)").fill("00000000-0000-0000-0000-000000000000");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText(/No ledger chain entry found/i)).toBeVisible();
  });

  test("once the checkpoint worker processes it, the UI renders the real 'Verified' pass verdict", async ({ page }) => {
    await page.goto("/verification");
    await page.getByPlaceholder("Record ID (journal entry or invoice)").fill(checkpointCandidateEntryId);

    // Polls by re-submitting the real form against the real API — this is
    // waiting on the actual checkpoint-worker's real schedule (a background
    // process this test does not control), not simulating the result.
    await expect(async () => {
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 90_000, intervals: [3000] });

    await expect(page.getByText("Signature valid")).toBeVisible();
    await expect(page.getByText("Yes").first()).toBeVisible();
    await expect(page.getByText(/Merkle proof path/)).toBeVisible();
  });
});
