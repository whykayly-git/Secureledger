import { test, expect, APIRequestContext } from "@playwright/test";
import { seedAccounts, SeededAccounts } from "./helpers";

let accounts: SeededAccounts;

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  accounts = await seedAccounts(request);
});

test.describe("Journal entries", () => {
  test("posting a balanced entry succeeds and appears in the journal list", async ({ page }) => {
    const description = `E2E balanced entry ${Date.now()}`;

    await page.goto("/journal/new");
    const rows = page.locator("div.grid.grid-cols-12.items-center.gap-2");

    await page.locator('input[required]:not([type])').fill(description); // description field

    await rows.nth(0).locator("select").selectOption(accounts.expenseAccountId);
    await rows.nth(0).locator('input[type="number"]').nth(0).fill("50"); // debit

    await rows.nth(1).locator("select").selectOption(accounts.cashAccountId);
    await rows.nth(1).locator('input[type="number"]').nth(1).fill("50"); // credit

    await expect(page.getByText("✓ Balanced")).toBeVisible();

    const postButton = page.getByRole("button", { name: "Post entry" });
    await expect(postButton).toBeEnabled();
    await postButton.click();

    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByText(description)).toBeVisible();
  });

  test("an unbalanced entry is blocked client-side and cannot be posted", async ({ page }) => {
    await page.goto("/journal/new");
    const rows = page.locator("div.grid.grid-cols-12.items-center.gap-2");

    await page.locator('input[required]:not([type])').fill(`E2E unbalanced entry ${Date.now()}`);

    await rows.nth(0).locator("select").selectOption(accounts.expenseAccountId);
    await rows.nth(0).locator('input[type="number"]').nth(0).fill("100"); // debit 100

    await rows.nth(1).locator("select").selectOption(accounts.cashAccountId);
    await rows.nth(1).locator('input[type="number"]').nth(1).fill("40"); // credit 40 — mismatched

    await expect(page.getByText("Not balanced")).toBeVisible();

    const postButton = page.getByRole("button", { name: "Post entry" });
    await expect(postButton).toBeDisabled();

    // Still on the form — nothing was posted.
    await expect(page).toHaveURL(/\/journal\/new$/);
  });
});
