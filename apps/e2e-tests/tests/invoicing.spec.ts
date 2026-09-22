import { test, expect, APIRequestContext } from "@playwright/test";
import { seedAccounts, SeededAccounts, fieldLocatorSelector } from "./helpers";

let accounts: SeededAccounts;

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  accounts = await seedAccounts(request);
});

test.describe("Invoicing", () => {
  test("a user can create a draft invoice and issue it through the UI", async ({ page }) => {
    const customerName = `E2E Customer ${Date.now()}`;

    await page.goto("/invoicing");
    await page.getByRole("button", { name: "+ New Invoice" }).click();

    await page.locator(fieldLocatorSelector("Customer name")).fill(customerName);
    await page.locator(fieldLocatorSelector("Receivable account")).selectOption(accounts.cashAccountId);

    const lineItemRow = page.locator("div.grid.grid-cols-12.gap-2").first();
    await lineItemRow.getByPlaceholder("Description").fill("Consulting services");
    await lineItemRow.getByPlaceholder("Qty").fill("1");
    await lineItemRow.getByPlaceholder("Unit price").fill("250");
    await lineItemRow.locator("select").selectOption(accounts.incomeAccountId);

    await expect(page.getByText("Total: $250.00")).toBeVisible();

    await page.getByRole("button", { name: "Create draft invoice" }).click();

    const row = page.getByRole("row", { name: new RegExp(customerName) });
    await expect(row).toBeVisible();
    await expect(row.getByText("DRAFT")).toBeVisible();

    await row.getByRole("button", { name: "Issue" }).click();
    await expect(row.getByText("ISSUED")).toBeVisible();
  });
});
