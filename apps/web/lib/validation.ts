import { ApiError } from "./api";
import type { InvoiceLineItemInput } from "./invoiceTypes";

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function validateBalancedLines(lines: { accountId: string; debit: number; credit: number }[]) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ApiError("A journal entry needs at least two lines", 400);
  }
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines) {
    if (!line.accountId) {
      throw new ApiError("Every line requires an account", 400);
    }
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit < 0 || credit < 0) {
      throw new ApiError("Debit and credit amounts must be non-negative", 400);
    }
    if (debit > 0 && credit > 0) {
      throw new ApiError("A single line cannot have both a debit and a credit", 400);
    }
    debitTotal += toCents(debit);
    creditTotal += toCents(credit);
  }
  if (debitTotal === 0 && creditTotal === 0) {
    throw new ApiError("Journal entry amounts cannot all be zero", 400);
  }
  if (debitTotal !== creditTotal) {
    throw new ApiError(
      `Debits (${(debitTotal / 100).toFixed(2)}) must equal credits (${(creditTotal / 100).toFixed(2)})`,
      400
    );
  }
}

export function validateInvoiceRequestShape(body: {
  customerName?: string;
  dueDate?: string;
  items?: unknown;
  receivableAccountId?: string;
}) {
  if (!body.customerName || !body.dueDate || !body.receivableAccountId) {
    throw new ApiError("customerName, dueDate and receivableAccountId are required", 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ApiError("At least one line item is required", 400);
  }
}

export function validateInvoiceLineItemShape(item: InvoiceLineItemInput) {
  if (!item.description || !(item.quantity > 0) || !(item.unitPrice >= 0)) {
    throw new ApiError("Each line item needs a description, positive quantity and non-negative unit price", 400);
  }
}
