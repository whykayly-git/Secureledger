import { test, expect } from "@playwright/test";
import { fieldLocatorSelector } from "./helpers";

test.describe("Chart of accounts", () => {
  test("a user can create a new account through the UI and see it listed", async ({ page }) => {
    const suffix = Date.now();
    const code = `9${String(suffix).slice(-4)}`;
    const name = `E2E Test Account ${suffix}`;

    await page.goto("/accounts");
    await page.getByRole("button", { name: "+ New Account" }).click();

    await page.locator(fieldLocatorSelector("Account code")).fill(code);
    await page.locator(fieldLocatorSelector("Account name")).fill(name);
    await page.locator(fieldLocatorSelector("Type")).selectOption("EXPENSE");
    await page.getByRole("button", { name: "Create account" }).click();

    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("EXPENSE")).toBeVisible();
    await expect(row.getByText(code)).toBeVisible();
  });

  test("search filters the account list", async ({ page }) => {
    const suffix = Date.now();
    const code = `8${String(suffix).slice(-4)}`;
    const name = `Searchable Account ${suffix}`;

    await page.goto("/accounts");
    await page.getByRole("button", { name: "+ New Account" }).click();
    await page.locator(fieldLocatorSelector("Account code")).fill(code);
    await page.locator(fieldLocatorSelector("Account name")).fill(name);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

    await page.getByPlaceholder("Search by name or code…").fill(name);
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("No accounts yet")).toHaveCount(0);
  });
});
