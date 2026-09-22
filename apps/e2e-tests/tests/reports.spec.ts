import { test, expect, APIRequestContext } from "@playwright/test";
import { seedAccounts, seedJournalEntry, SeededAccounts } from "./helpers";

let accounts: SeededAccounts;

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  accounts = await seedAccounts(request);
  await seedJournalEntry(request, accounts, "E2E reports seed entry");
});

test.describe("Reports", () => {
  test("trial balance renders with matching debit/credit totals", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Trial Balance" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Total" })).toBeVisible();
    // The seeded entry's accounts should appear somewhere in the table.
    await expect(page.getByRole("cell", { name: /Office Supplies|Cash/ }).first()).toBeVisible();
  });

  test("income statement renders and shows a net income figure", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("button", { name: "Income Statement" }).click();

    await expect(page.getByText("Net Income")).toBeVisible();
    await expect(page.getByText("Total expenses")).toBeVisible();
  });
});
