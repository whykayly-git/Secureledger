export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  incomeAccountId: string;
};

export type InvoiceLineItems = {
  items: InvoiceLineItem[];
  receivableAccountId: string;
};

export function computeInvoiceAmount(items: InvoiceLineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}
