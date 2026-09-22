import { prisma } from "@secureledger/db";
import { appendLedgerChainEntry, invoiceHashFields, journalEntryHashFields } from "@secureledger/ledger";
import type { TestOrgContext } from "./harness";

export type MidTransactionFailureResult = {
  recordId: string;
  error: Error;
};

/**
 * Mirrors the real journal-entry posting transaction, but injects a
 * deliberate failure (a division-by-zero raw query — a real Postgres
 * error, not a thrown JS exception) AFTER the JournalEntry write and
 * BEFORE the hash-chain write, then never reaches the real
 * appendLedgerChainEntry call. This is the "test hook": no production
 * code is modified — the injection point lives entirely in this test's
 * own transaction, composed from the same real primitives
 * (tx.journalEntry.create + appendLedgerChainEntry) the app uses.
 */
export async function attemptFailingJournalEntryPost(ctx: TestOrgContext): Promise<MidTransactionFailureResult> {
  let capturedEntryId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          organisationId: ctx.organisationId,
          date: new Date(),
          description: "Entry that must roll back entirely on mid-transaction failure",
          status: "POSTED",
          createdById: ctx.userId,
          lines: {
            create: [
              { accountId: ctx.expenseAccountId, debit: 10, credit: 0 },
              { accountId: ctx.cashAccountId, debit: 0, credit: 10 },
            ],
          },
        },
        include: { lines: true },
      });
      capturedEntryId = entry.id;

      // Injected failure point — a real Postgres error (division by zero),
      // occurring strictly after the accounting write and before the
      // hash-chain write.
      await tx.$executeRawUnsafe("SELECT 1/0");

      // Never reached — kept here so the transaction's shape matches
      // production exactly up to the injected failure.
      await appendLedgerChainEntry(tx, {
        organisationId: ctx.organisationId,
        recordType: "JOURNAL_ENTRY",
        recordId: entry.id,
        fields: journalEntryHashFields(entry),
      });
    });
    throw new Error("Expected the transaction to fail, but it committed successfully");
  } catch (err) {
    return { recordId: capturedEntryId, error: err as Error };
  }
}

/** Same as above, for the invoice write path. */
export async function attemptFailingInvoicePost(ctx: TestOrgContext): Promise<MidTransactionFailureResult> {
  let capturedInvoiceId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          organisationId: ctx.organisationId,
          customerName: "Rollback Test Customer",
          lineItems: { items: [], receivableAccountId: ctx.cashAccountId },
          amount: 10,
          status: "DRAFT",
          dueDate: new Date(),
        },
      });
      capturedInvoiceId = invoice.id;

      await tx.$executeRawUnsafe("SELECT 1/0");

      await appendLedgerChainEntry(tx, {
        organisationId: ctx.organisationId,
        recordType: "INVOICE",
        recordId: invoice.id,
        fields: invoiceHashFields(invoice),
      });
    });
    throw new Error("Expected the transaction to fail, but it committed successfully");
  } catch (err) {
    return { recordId: capturedInvoiceId, error: err as Error };
  }
}

export type ChainRow = {
  id: string;
  hash: string;
  previousHash: string | null;
  createdAt: Date;
};

export async function getChainRows(organisationId: string): Promise<ChainRow[]> {
  return prisma.ledgerChain.findMany({
    where: { organisationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, hash: true, previousHash: true, createdAt: true },
  });
}

export type ChainIntegrityResult = {
  valid: boolean;
  totalRows: number;
  visitedRows: number;
  issues: string[];
};

/**
 * Validates that a set of LedgerChain rows forms exactly one linear,
 * unforked chain: exactly one genesis row (previousHash === null), no two
 * rows share the same previousHash (no fork point), and walking forward
 * from genesis via hash -> previousHash links visits every single row
 * (no orphans / dropped / disconnected records).
 */
export function validateLinearChain(rows: ChainRow[]): ChainIntegrityResult {
  const issues: string[] = [];

  const genesisRows = rows.filter((r) => r.previousHash === null);
  if (genesisRows.length !== 1) {
    issues.push(`Expected exactly 1 genesis row (previousHash === null), found ${genesisRows.length}`);
  }

  const childrenByPreviousHash = new Map<string, ChainRow[]>();
  for (const row of rows) {
    if (row.previousHash === null) continue;
    const list = childrenByPreviousHash.get(row.previousHash) ?? [];
    list.push(row);
    childrenByPreviousHash.set(row.previousHash, list);
  }
  for (const [prevHash, children] of childrenByPreviousHash.entries()) {
    if (children.length > 1) {
      issues.push(
        `Fork detected: ${children.length} rows share previousHash ${prevHash.slice(0, 12)}… (ids: ${children
          .map((c) => c.id)
          .join(", ")})`
      );
    }
  }

  const visitedIds = new Set<string>();
  if (genesisRows.length > 0) {
    let current: ChainRow | undefined = genesisRows[0];
    while (current && !visitedIds.has(current.id)) {
      visitedIds.add(current.id);
      const nextCandidates: ChainRow[] = childrenByPreviousHash.get(current.hash) ?? [];
      current = nextCandidates[0];
    }
  }

  if (visitedIds.size !== rows.length) {
    issues.push(
      `Chain walk visited ${visitedIds.size} of ${rows.length} rows — ${
        rows.length - visitedIds.size
      } rows are orphaned/disconnected from the single linear chain`
    );
  }

  return { valid: issues.length === 0, totalRows: rows.length, visitedRows: visitedIds.size, issues };
}
