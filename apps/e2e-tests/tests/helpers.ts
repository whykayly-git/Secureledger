import { APIRequestContext } from "@playwright/test";

export type SeededAccounts = {
  cashAccountId: string;
  expenseAccountId: string;
  incomeAccountId: string;
};

/**
 * Seeds a Cash/Expense/Income account via the real API (fast, deterministic
 * setup for tests that exercise journal entries/invoices/reports, which is
 * separate from accounts.spec.ts's own job of testing account creation
 * THROUGH the UI). Uses the request fixture's already-authenticated
 * session (see global-setup.ts).
 */
export async function seedAccounts(request: APIRequestContext): Promise<SeededAccounts> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const cash = await request.post("/api/accounts", {
    data: { name: `Cash ${suffix}`, type: "ASSET", code: `1000-${suffix}` },
  });
  const expense = await request.post("/api/accounts", {
    data: { name: `Office Supplies ${suffix}`, type: "EXPENSE", code: `5000-${suffix}` },
  });
  const income = await request.post("/api/accounts", {
    data: { name: `Consulting Revenue ${suffix}`, type: "INCOME", code: `4000-${suffix}` },
  });

  const [cashJson, expenseJson, incomeJson] = await Promise.all([cash.json(), expense.json(), income.json()]);

  return {
    cashAccountId: cashJson.account.id,
    expenseAccountId: expenseJson.account.id,
    incomeAccountId: incomeJson.account.id,
  };
}

/** Posts a balanced journal entry via the real API, for tests that need one to already exist. */
export async function seedJournalEntry(
  request: APIRequestContext,
  accounts: SeededAccounts,
  description = "E2E seeded entry"
): Promise<string> {
  const res = await request.post("/api/journal-entries", {
    data: {
      date: new Date().toISOString().slice(0, 10),
      description,
      lines: [
        { accountId: accounts.expenseAccountId, debit: 50, credit: 0 },
        { accountId: accounts.cashAccountId, debit: 0, credit: 50 },
      ],
    },
  });
  const json = await res.json();
  return json.journalEntry.id;
}

/** Locates the <input>/<select>/<textarea> that sits in the same wrapping div as a given label's text. */
export function fieldLocatorSelector(labelText: string): string {
  return `div:has(> label:text-is("${labelText}")) :is(input, select, textarea)`;
}
