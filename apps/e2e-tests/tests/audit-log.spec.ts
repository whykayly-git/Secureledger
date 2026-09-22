import { test, expect, APIRequestContext } from "@playwright/test";
import { seedAccounts, seedJournalEntry, SeededAccounts } from "./helpers";

let accounts: SeededAccounts;

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  accounts = await seedAccounts(request);
});

test.describe("Audit log", () => {
  test("shows a chronological, hash-referenced entry for a posted journal entry", async ({ page, request }) => {
    const description = `E2E audit log entry ${Date.now()}`;
    await seedJournalEntry(request as APIRequestContext, accounts, description);

    await page.goto("/audit-log");

    const row = page.getByRole("row", { name: new RegExp(description) });
    await expect(row).toBeVisible();
    await expect(row.getByText("JOURNAL ENTRY")).toBeVisible();
    await expect(row.getByRole("link", { name: "Verify" })).toBeVisible();
  });

  test("filtering by record type narrows the audit log", async ({ page }) => {
    await page.goto("/audit-log");
    await page.getByRole("combobox").selectOption("JOURNAL_ENTRY");

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("INVOICE", { exact: true })).toHaveCount(0);
  });

  test("the auditor-only batch export button is not shown to a non-auditor role", async ({ page }) => {
    await page.goto("/audit-log");
    // The global-setup user registers as ACCOUNTANT, not AUDITOR.
    await expect(page.getByText(/Export batch verification/i)).toHaveCount(0);
  });
});
