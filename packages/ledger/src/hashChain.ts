import { computeChainHash } from "@secureledger/crypto";
import type { Prisma, LedgerChain, LedgerRecordType } from "@secureledger/db";
import { signChainRow } from "./authTag";

export type AppendChainParams = {
  organisationId: string;
  recordType: LedgerRecordType;
  recordId: string;
  fields: Record<string, unknown>;
};

/**
 * Appends one hash-chained LedgerChain row, atomically, inside the SAME
 * Prisma transaction as the accounting write it accompanies. Must run
 * synchronously and add negligible latency — no Merkle work happens here,
 * that belongs entirely to the checkpoint worker.
 *
 * Concurrency: two ledger writes for the same organisation racing each
 * other must not both read the same "previous hash" and fork the chain.
 * We serialize per-organisation with a PostgreSQL advisory lock keyed on
 * a hash of the organisationId (`pg_advisory_xact_lock`), acquired before
 * reading the current chain tip. The `_xact_` variant is held only for
 * the duration of this transaction and is released automatically on
 * commit or rollback — no explicit unlock needed, and no risk of a lock
 * surviving a crashed connection.
 *
 * Scoping the lock key to the organisationId (rather than locking a
 * shared resource) means postings for different organisations never
 * block each other — only concurrent postings for the SAME organisation
 * serialize, which is exactly the multi-tenant throughput requirement.
 *
 * This is the single real write path used by every ledger-affecting
 * write in the codebase — apps/web's journal-entry and invoice routes,
 * and apps/security-tests' seeding harness — so this one fix covers all
 * of them consistently.
 */
export async function appendLedgerChainEntry(
  tx: Prisma.TransactionClient,
  params: AppendChainParams
): Promise<LedgerChain> {
  const { organisationId, recordType, recordId, fields } = params;

  // $executeRaw (not $queryRaw) deliberately: pg_advisory_xact_lock returns
  // `void`, which Prisma's query engine cannot deserialize as a result
  // column. $executeRaw discards the result set entirely (it only reports
  // the affected-row count), which is exactly right for a call made purely
  // for its locking side effect.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))`;

  const tip = await tx.ledgerChain.findFirst({
    where: { organisationId },
    orderBy: [{ createdAt: "desc" }],
    select: { hash: true, sequenceNumber: true },
  });

  const previousHash = tip?.hash ?? null;
  const hash = computeChainHash(fields, previousHash);
  const sequenceNumber = (tip?.sequenceNumber ?? 0) + 1;

  // Keyed tag over this row's position and hash. A forger with database access
  // can compute `hash` (the method is public) but not this.
  const authTag = signChainRow({ organisationId, recordType, recordId, sequenceNumber, hash });

  return tx.ledgerChain.create({
    data: {
      organisationId,
      recordType,
      recordId,
      hash,
      previousHash,
      sequenceNumber,
      authTag,
    },
  });
}

/**
 * Canonical field selection for each record type — exactly the fields
 * that determine a record's integrity are included, nothing derived or
 * mutable-by-reference (e.g. no relation objects, only scalar values).
 */
export function journalEntryHashFields(entry: {
  id: string;
  organisationId: string;
  date: Date;
  description: string;
  status: string;
  createdById: string;
  lines: { accountId: string; debit: unknown; credit: unknown }[];
}) {
  return {
    id: entry.id,
    organisationId: entry.organisationId,
    date: entry.date,
    description: entry.description,
    status: entry.status,
    createdById: entry.createdById,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
    })),
  };
}

export function invoiceHashFields(invoice: {
  id: string;
  organisationId: string;
  customerName: string;
  lineItems: unknown;
  amount: unknown;
  status: string;
  dueDate: Date;
}) {
  return {
    id: invoice.id,
    organisationId: invoice.organisationId,
    customerName: invoice.customerName,
    lineItems: invoice.lineItems,
    amount: invoice.amount,
    status: invoice.status,
    dueDate: invoice.dueDate,
  };
}
