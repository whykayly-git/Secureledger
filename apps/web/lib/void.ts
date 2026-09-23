import type { Prisma, JournalEntry, JournalLine } from "@secureledger/db";
import { appendLedgerChainEntry, journalEntryHashFields } from "@secureledger/ledger";

/**
 * Creates a reversing JournalEntry for an original posted entry: same
 * accounts and amounts, debit/credit swapped, tagged with
 * `reversalOfEntryId` pointing back at the original. Posted through the
 * REAL write path (appendLedgerChainEntry) inside the caller's
 * transaction, so it is hash-chained and advisory-lock protected exactly
 * like any other ledger-affecting write.
 *
 * Used by both journal-entry voiding and invoice voiding (which reverses
 * the invoice's linked recognition entry) — one implementation, so the
 * two modules can't drift apart.
 */
export async function createReversingEntry(
  tx: Prisma.TransactionClient,
  params: {
    organisationId: string;
    originalEntry: JournalEntry & { lines: JournalLine[] };
    description: string;
    createdById: string;
  }
): Promise<JournalEntry & { lines: JournalLine[] }> {
  const { organisationId, originalEntry, description, createdById } = params;

  const reversing = await tx.journalEntry.create({
    data: {
      organisationId,
      date: new Date(),
      description,
      status: "POSTED",
      createdById,
      reversalOfEntryId: originalEntry.id,
      lines: {
        create: originalEntry.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit, // swapped
          credit: line.debit, // swapped
          memo: line.memo,
        })),
      },
    },
    include: { lines: true },
  });

  await appendLedgerChainEntry(tx, {
    organisationId,
    recordType: "JOURNAL_ENTRY",
    recordId: reversing.id,
    fields: journalEntryHashFields(reversing),
  });

  return reversing;
}

/** Records a non-ledger administrative action (draft delete, etc.) for the audit trail. */
export async function logAdminAction(
  tx: Prisma.TransactionClient,
  params: {
    organisationId: string;
    userId: string;
    action: string;
    targetType: "JOURNAL_ENTRY" | "INVOICE" | "USER";
    targetId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await tx.adminActionLog.create({
    data: {
      organisationId: params.organisationId,
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
