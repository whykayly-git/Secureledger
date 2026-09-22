import { ApiError } from "../lib/api";
import {
  toCents,
  validateBalancedLines,
  validateInvoiceLineItemShape,
  validateInvoiceRequestShape,
} from "../lib/validation";
import { computeInvoiceAmount } from "../lib/invoiceTypes";

describe("toCents", () => {
  it("converts a dollar amount to whole cents", () => {
    expect(toCents(10.5)).toBe(1050);
  });

  it("rounds to the nearest cent to avoid floating-point drift", () => {
    expect(toCents(10.1) + toCents(10.2)).toBe(2030);
  });

  it("handles zero", () => {
    expect(toCents(0)).toBe(0);
  });
});

describe("validateBalancedLines", () => {
  const validLines = [
    { accountId: "expense-acc", debit: 50, credit: 0 },
    { accountId: "cash-acc", debit: 0, credit: 50 },
  ];

  it("does not throw for a valid, balanced two-line entry", () => {
    expect(() => validateBalancedLines(validLines)).not.toThrow();
  });

  it("does not throw for a valid, balanced multi-line entry", () => {
    const lines = [
      { accountId: "a", debit: 30, credit: 0 },
      { accountId: "b", debit: 20, credit: 0 },
      { accountId: "c", debit: 0, credit: 50 },
    ];
    expect(() => validateBalancedLines(lines)).not.toThrow();
  });

  it("throws when lines is not an array", () => {
    expect(() => validateBalancedLines(undefined as any)).toThrow(ApiError);
  });

  it("throws when there are fewer than two lines", () => {
    expect(() => validateBalancedLines([{ accountId: "a", debit: 50, credit: 0 }])).toThrow(
      /at least two lines/i
    );
  });

  it("throws when a line is missing an accountId", () => {
    const lines = [
      { accountId: "", debit: 50, credit: 0 },
      { accountId: "b", debit: 0, credit: 50 },
    ];
    expect(() => validateBalancedLines(lines as any)).toThrow(/requires an account/i);
  });

  it("throws when a debit amount is negative", () => {
    const lines = [
      { accountId: "a", debit: -10, credit: 0 },
      { accountId: "b", debit: 0, credit: 10 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/non-negative/i);
  });

  it("throws when a credit amount is negative", () => {
    const lines = [
      { accountId: "a", debit: 10, credit: 0 },
      { accountId: "b", debit: 0, credit: -10 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/non-negative/i);
  });

  it("throws when a single line has both a debit and a credit", () => {
    const lines = [
      { accountId: "a", debit: 10, credit: 5 },
      { accountId: "b", debit: 0, credit: 5 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/cannot have both/i);
  });

  it("throws when every amount is zero", () => {
    const lines = [
      { accountId: "a", debit: 0, credit: 0 },
      { accountId: "b", debit: 0, credit: 0 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/cannot all be zero/i);
  });

  it("throws when debits do not equal credits", () => {
    const lines = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 50 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/must equal credits/i);
  });

  it("includes the actual debit and credit totals in the unbalanced-entry error message", () => {
    const lines = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 75 },
    ];
    expect(() => validateBalancedLines(lines)).toThrow(/100\.00.*75\.00/);
  });

  it("correctly balances amounts that would be misjudged by naive floating-point comparison", () => {
    // 0.1 + 0.2 !== 0.3 in raw floating point; toCents-based comparison must still balance this.
    const lines = [
      { accountId: "a", debit: 0.1, credit: 0 },
      { accountId: "b", debit: 0.2, credit: 0 },
      { accountId: "c", debit: 0, credit: 0.3 },
    ];
    expect(() => validateBalancedLines(lines)).not.toThrow();
  });

  it("throws an ApiError with HTTP status 400 for validation failures", () => {
    try {
      validateBalancedLines([]);
      throw new Error("expected validateBalancedLines to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
    }
  });
});

describe("validateInvoiceRequestShape", () => {
  const validBody = {
    customerName: "Acme Co",
    dueDate: "2026-01-01",
    items: [{ description: "Consulting", quantity: 1, unitPrice: 100, incomeAccountId: "income-1" }],
    receivableAccountId: "receivable-1",
  };

  it("does not throw for a valid request body", () => {
    expect(() => validateInvoiceRequestShape(validBody)).not.toThrow();
  });

  it("throws when customerName is missing", () => {
    expect(() => validateInvoiceRequestShape({ ...validBody, customerName: undefined })).toThrow(
      /customerName/i
    );
  });

  it("throws when dueDate is missing", () => {
    expect(() => validateInvoiceRequestShape({ ...validBody, dueDate: undefined })).toThrow(/dueDate/i);
  });

  it("throws when receivableAccountId is missing", () => {
    expect(() => validateInvoiceRequestShape({ ...validBody, receivableAccountId: undefined })).toThrow(
      /receivableAccountId/i
    );
  });

  it("throws when items is not an array", () => {
    expect(() => validateInvoiceRequestShape({ ...validBody, items: "not-an-array" })).toThrow(
      /line item/i
    );
  });

  it("throws when items is an empty array", () => {
    expect(() => validateInvoiceRequestShape({ ...validBody, items: [] })).toThrow(/at least one line item/i);
  });
});

describe("validateInvoiceLineItemShape", () => {
  const validItem = { description: "Consulting", quantity: 2, unitPrice: 50, incomeAccountId: "income-1" };

  it("does not throw for a valid line item", () => {
    expect(() => validateInvoiceLineItemShape(validItem)).not.toThrow();
  });

  it("allows a unit price of exactly zero (free line item)", () => {
    expect(() => validateInvoiceLineItemShape({ ...validItem, unitPrice: 0 })).not.toThrow();
  });

  it("throws when description is missing", () => {
    expect(() => validateInvoiceLineItemShape({ ...validItem, description: "" })).toThrow(/description/i);
  });

  it("throws when quantity is zero", () => {
    expect(() => validateInvoiceLineItemShape({ ...validItem, quantity: 0 })).toThrow(/positive quantity/i);
  });

  it("throws when quantity is negative", () => {
    expect(() => validateInvoiceLineItemShape({ ...validItem, quantity: -1 })).toThrow(/positive quantity/i);
  });

  it("throws when unitPrice is negative", () => {
    expect(() => validateInvoiceLineItemShape({ ...validItem, unitPrice: -5 })).toThrow(/non-negative unit price/i);
  });
});

describe("computeInvoiceAmount", () => {
  it("sums quantity * unitPrice across all line items", () => {
    const items = [
      { description: "A", quantity: 2, unitPrice: 10, incomeAccountId: "x" },
      { description: "B", quantity: 1, unitPrice: 5, incomeAccountId: "y" },
    ];
    expect(computeInvoiceAmount(items)).toBe(25);
  });

  it("returns 0 for an empty item list", () => {
    expect(computeInvoiceAmount([])).toBe(0);
  });
});
