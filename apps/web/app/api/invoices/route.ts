import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { appendLedgerChainEntry, invoiceHashFields } from "@secureledger/ledger";
import { computeInvoiceAmount, InvoiceLineItem } from "@/lib/invoiceTypes";
import { validateInvoiceRequestShape, validateInvoiceLineItemShape } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const invoices = await prisma.invoice.findMany({
      where: {
        organisationId: session.organisationId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const recordIds = invoices.map((i) => i.id);
    const chainRows = await prisma.ledgerChain.findMany({
      where: { recordId: { in: recordIds }, recordType: "INVOICE" },
      select: { recordId: true, hash: true, checkpointId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const latestChainByRecordId = new Map<string, (typeof chainRows)[number]>();
    for (const row of chainRows) {
      if (!latestChainByRecordId.has(row.recordId)) latestChainByRecordId.set(row.recordId, row);
    }

    const result = invoices.map((invoice) => ({
      ...invoice,
      chain: latestChainByRecordId.get(invoice.id) ?? null,
    }));

    return NextResponse.json({ invoices: result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const { customerName, dueDate, items, receivableAccountId } = body ?? {};

    validateInvoiceRequestShape({ customerName, dueDate, items, receivableAccountId });

    const receivableAccount = await prisma.account.findFirst({
      where: { id: receivableAccountId, organisationId: session.organisationId, type: "ASSET" },
    });
    if (!receivableAccount) {
      throw new ApiError("receivableAccountId must reference an ASSET account in your chart of accounts", 400);
    }

    const incomeAccountIds: string[] = [...new Set<string>(items.map((i: InvoiceLineItem) => i.incomeAccountId))];
    const incomeAccounts = await prisma.account.findMany({
      where: { id: { in: incomeAccountIds }, organisationId: session.organisationId, type: "INCOME" },
    });
    if (incomeAccounts.length !== incomeAccountIds.length) {
      throw new ApiError("Every line item must reference an INCOME account in your chart of accounts", 400);
    }

    for (const item of items as InvoiceLineItem[]) {
      validateInvoiceLineItemShape(item);
    }

    const amount = computeInvoiceAmount(items);
    const lineItems = { items, receivableAccountId };

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          organisationId: session.organisationId,
          customerName,
          lineItems,
          amount,
          status: "DRAFT",
          dueDate: new Date(dueDate),
        },
      });

      await appendLedgerChainEntry(tx, {
        organisationId: session.organisationId,
        recordType: "INVOICE",
        recordId: created.id,
        fields: invoiceHashFields(created),
      });

      return created;
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
