/** Shape the client sends for one line item — before lineTotal is computed. */
export type InvoiceLineItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  incomeAccountId: string;
};

/** Shape actually persisted — always includes a server-computed lineTotal. */
export type InvoiceLineItem = InvoiceLineItemInput & { lineTotal: number };

export type InvoiceLineItems = {
  items: InvoiceLineItem[];
  receivableAccountId: string;
};

export function computeInvoiceAmount(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/**
 * Stamps each item with a server-computed lineTotal (quantity * unitPrice)
 * before persisting — never trusts a lineTotal the client may have sent,
 * even though the client also computes one for its own live display.
 */
export function withLineTotals(items: InvoiceLineItemInput[]): InvoiceLineItem[] {
  return items.map((item) => ({ ...item, lineTotal: item.quantity * item.unitPrice }));
}
