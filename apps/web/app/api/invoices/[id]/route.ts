import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import type { InvoiceStatus, Prisma } from "@secureledger/db";
import { requireSession, requireRole } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { appendLedgerChainEntry, invoiceHashFields, journalEntryHashFields } from "@secureledger/ledger";
import { InvoiceLineItems } from "@/lib/invoiceTypes";
import { createReversingEntry, logAdminAction } from "@/lib/void";

/**
 * Moves an invoice out of one of the `from` statuses, as the first step of the
 * transaction. The status check at the top of the handler is only a quick
 * rejection: two requests can both pass it before either commits. This
 * conditional update is the real guard. The second request waits on the row
 * lock, then finds the status already changed, matches no row and is refused,
 * so the invoice can never be issued, paid or voided twice.
 */
async function claimInvoiceStatus(
  tx: Prisma.TransactionClient,
  invoice: { id: string; organisationId: string },
  from: InvoiceStatus[],
  to: InvoiceStatus,
  message: string
) {
  const claimed = await tx.invoice.updateMany({
    where: { id: invoice.id, organisationId: invoice.organisationId, status: { in: from } },
    data: { status: to },
  });
  if (claimed.count !== 1) throw new ApiError(message, 409);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!invoice) throw new ApiError("Invoice not found", 404);
    return NextResponse.json({ invoice });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const body = await request.json();
    const { action, cashAccountId, reason } = body ?? {};

    if (action !== "issue" && action !== "pay" && action !== "void") {
      throw new ApiError("action must be 'issue', 'pay', or 'void'", 400);
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!invoice) throw new ApiError("Invoice not found", 404);

    const lineItems = invoice.lineItems as unknown as InvoiceLineItems;

    if (action === "void") {
      requireRole(session, "ACCOUNTANT", "AUDITOR");
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        throw new ApiError("A reason is required to void an invoice", 400);
      }
      if (invoice.status !== "ISSUED" && invoice.status !== "PAID") {
        throw new ApiError("Only issued or paid invoices can be voided", 409);
      }
      if (!invoice.relatedJournalEntryId) {
        throw new ApiError("Invoice has no linked journal entry to reverse", 409);
      }

      const linkedEntry = await prisma.journalEntry.findUnique({
        where: { id: invoice.relatedJournalEntryId },
        include: { lines: true },
      });
      if (!linkedEntry) {
        throw new ApiError("Invoice's linked journal entry no longer exists", 500);
      }

      const result = await prisma.$transaction(async (tx) => {
        await claimInvoiceStatus(tx, invoice, ["ISSUED", "PAID"], "VOIDED", "Only issued or paid invoices can be voided");

        const reversingEntry = await createReversingEntry(tx, {
          organisationId: session.organisationId,
          originalEntry: linkedEntry,
          description: `Reversal of invoice to ${invoice.customerName}: ${reason.trim()}`,
          createdById: session.userId,
        });

        const voidedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "VOIDED",
            voidedByUserId: session.userId,
            voidedAt: new Date(),
            voidReason: reason.trim(),
          },
        });

        await appendLedgerChainEntry(tx, {
          organisationId: session.organisationId,
          recordType: "INVOICE",
          recordId: voidedInvoice.id,
          fields: invoiceHashFields(voidedInvoice),
        });

        return { voidedInvoice, reversingEntry };
      });

      return NextResponse.json({ invoice: result.voidedInvoice, reversingEntry: result.reversingEntry });
    }

    if (action === "issue") {
      if (invoice.status !== "DRAFT") {
        throw new ApiError("Only draft invoices can be issued", 409);
      }

      const updated = await prisma.$transaction(async (tx) => {
        await claimInvoiceStatus(tx, invoice, ["DRAFT"], "ISSUED", "Only draft invoices can be issued");

        // Group revenue by income account in case multiple line items share one.
        const revenueByAccount = new Map<string, number>();
        for (const item of lineItems.items) {
          const total = item.quantity * item.unitPrice;
          revenueByAccount.set(item.incomeAccountId, (revenueByAccount.get(item.incomeAccountId) ?? 0) + total);
        }

        const journalEntry = await tx.journalEntry.create({
          data: {
            organisationId: session.organisationId,
            date: new Date(),
            description: `Invoice issued to ${invoice.customerName}`,
            status: "POSTED",
            createdById: session.userId,
            lines: {
              create: [
                { accountId: lineItems.receivableAccountId, debit: Number(invoice.amount), credit: 0 },
                ...[...revenueByAccount.entries()].map(([accountId, credit]) => ({
                  accountId,
                  debit: 0,
                  credit,
                })),
              ],
            },
          },
          include: { lines: true },
        });

        await appendLedgerChainEntry(tx, {
          organisationId: session.organisationId,
          recordType: "JOURNAL_ENTRY",
          recordId: journalEntry.id,
          fields: journalEntryHashFields(journalEntry),
        });

        const invoiceUpdated = await tx.invoice.update({
          where: { id: invoice.id },
          data: { relatedJournalEntryId: journalEntry.id },
        });

        await appendLedgerChainEntry(tx, {
          organisationId: session.organisationId,
          recordType: "INVOICE",
          recordId: invoiceUpdated.id,
          fields: invoiceHashFields(invoiceUpdated),
        });

        return invoiceUpdated;
      });

      return NextResponse.json({ invoice: updated });
    }

    // action === "pay"
    if (invoice.status !== "ISSUED") {
      throw new ApiError("Only issued invoices can be marked as paid", 409);
    }
    if (!cashAccountId) {
      throw new ApiError("cashAccountId is required to record payment", 400);
    }
    const cashAccount = await prisma.account.findFirst({
      where: { id: cashAccountId, organisationId: session.organisationId, type: "ASSET" },
    });
    if (!cashAccount) {
      throw new ApiError("cashAccountId must reference an ASSET account", 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await claimInvoiceStatus(tx, invoice, ["ISSUED"], "PAID", "Only issued invoices can be marked as paid");

      const journalEntry = await tx.journalEntry.create({
        data: {
          organisationId: session.organisationId,
          date: new Date(),
          description: `Payment received for invoice from ${invoice.customerName}`,
          status: "POSTED",
          createdById: session.userId,
          lines: {
            create: [
              { accountId: cashAccountId, debit: Number(invoice.amount), credit: 0 },
              { accountId: lineItems.receivableAccountId, debit: 0, credit: Number(invoice.amount) },
            ],
          },
        },
        include: { lines: true },
      });

      await appendLedgerChainEntry(tx, {
        organisationId: session.organisationId,
        recordType: "JOURNAL_ENTRY",
        recordId: journalEntry.id,
        fields: journalEntryHashFields(journalEntry),
      });

      const invoiceUpdated = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

      await appendLedgerChainEntry(tx, {
        organisationId: session.organisationId,
        recordType: "INVOICE",
        recordId: invoiceUpdated.id,
        fields: invoiceHashFields(invoiceUpdated),
      });

      return invoiceUpdated;
    });

    return NextResponse.json({ invoice: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Delete a draft invoice (never issued, no linked journal entry, never hash-chained). */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requireRole(session, "ACCOUNTANT", "AUDITOR");

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (invoice.status !== "DRAFT") {
      throw new ApiError("Only draft invoices can be deleted — issued/paid invoices must be voided instead", 409);
    }

    await prisma.$transaction(async (tx) => {
      // Conditional on still being a draft, so a concurrent issue cannot be deleted from under it.
      const deleted = await tx.invoice.deleteMany({
        where: { id: invoice.id, organisationId: session.organisationId, status: "DRAFT" },
      });
      if (deleted.count !== 1) {
        throw new ApiError("Only draft invoices can be deleted — issued/paid invoices must be voided instead", 409);
      }
      await logAdminAction(tx, {
        organisationId: session.organisationId,
        userId: session.userId,
        action: "DELETE_DRAFT_INVOICE",
        targetType: "INVOICE",
        targetId: invoice.id,
        metadata: { customerName: invoice.customerName },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
