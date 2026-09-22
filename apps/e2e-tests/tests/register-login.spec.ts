import { test, expect } from "@playwright/test";
import { fieldLocatorSelector } from "./helpers";

// This spec deliberately starts unauthenticated (overriding the
// pre-logged-in storageState every other spec file uses) — it exercises
// the real register + login UI flow itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Register and log in", () => {
  test("a new user can register, land on the dashboard, log out, and log back in", async ({ page }) => {
    const email = `e2e-ui+${Date.now()}@example.com`;
    const password = "e2e-ui-test-password-123";

    await page.goto("/register");
    await page.locator(fieldLocatorSelector("Organisation name")).fill("Playwright UI Org");
    await page.locator(fieldLocatorSelector("Your name")).fill("UI Test User");
    await page.locator(fieldLocatorSelector("Email")).fill(email);
    await page.locator(fieldLocatorSelector("Password")).fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Dashboard", { exact: true })).toBeVisible();

    // Log out via the topbar button.
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Log back in with the same credentials.
    await page.locator(fieldLocatorSelector("Email")).fill(email);
    await page.locator(fieldLocatorSelector("Password")).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Dashboard", { exact: true })).toBeVisible();
  });

  test("shows an error for a login with the wrong password", async ({ page }) => {
    const email = `e2e-ui-badlogin+${Date.now()}@example.com`;

    await page.goto("/register");
    await page.locator(fieldLocatorSelector("Organisation name")).fill("Playwright UI Org 2");
    await page.locator(fieldLocatorSelector("Your name")).fill("UI Test User 2");
    await page.locator(fieldLocatorSelector("Email")).fill(email);
    await page.locator(fieldLocatorSelector("Password")).fill("the-correct-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.locator(fieldLocatorSelector("Email")).fill(email);
    await page.locator(fieldLocatorSelector("Password")).fill("the-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
