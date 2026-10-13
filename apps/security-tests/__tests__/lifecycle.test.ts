/**
 * Lifecycle verification tests: legitimate status changes must not look like
 * tampering, and real tampering must still be caught.
 *
 * A journal entry is chained once, when POSTED; voiding later flips it to VOID
 * and posts a reversing entry. An invoice is chained again at every transition
 * (ISSUED, PAID, VOIDED). Verification has to recompute each row over the
 * status it was hashed with, not the record's current status.
 *
 * Writes use the same appendLedgerChainEntry / *HashFields helpers as the
 * apps/web routes; verification is the real @secureledger/verification
 * package. Requires a reachable DATABASE_URL (see .env.example).
 */
import { prisma } from "@secureledger/db";
import {
  appendLedgerChainEntry,
  COUNTED_ENTRY_STATUSES,
  invoiceHashFields,
  journalEntryHashFields,
} from "@secureledger/ledger";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import {
  createTestOrganisation,
  disconnectHarness,
  postJournalEntry,
  runCheckpoint,
  teardownOrganisation,
  TestOrgContext,
} from "../src/harness";

let ctx: TestOrgContext;

beforeEach(async () => {
  ctx = await createTestOrganisation("lifecycle");
});

afterEach(async () => {
  await teardownOrganisation(ctx.organisationId);
});

afterAll(async () => {
  await disconnectHarness();
});

async function verdictOf(chainId: string) {
  const result = await verifyLedgerChainEntryById(chainId, ctx.organisationId);
  return result as NonNullable<typeof result>;
}

/** Same effect as PATCH /api/journal-entries/[id] with action "void". */
async function voidEntry(entryId: string) {
  const original = await prisma.journalEntry.findFirstOrThrow({
    where: { id: entryId },
    include: { lines: true },
  });
  await prisma.$transaction(async (tx) => {
    const reversing = await tx.journalEntry.create({
      data: {
        organisationId: ctx.organisationId,
        date: new Date(),
        description: "Reversal",
        status: "POSTED",
        createdById: ctx.userId,
        reversalOfEntryId: original.id,
        lines: {
          create: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
        },
      },
      include: { lines: true },
    });
    await appendLedgerChainEntry(tx, {
      organisationId: ctx.organisationId,
      recordType: "JOURNAL_ENTRY",
      recordId: reversing.id,
      fields: journalEntryHashFields(reversing),
    });
    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: "VOID", voidedByUserId: ctx.userId, voidedAt: new Date(), voidReason: "test" },
    });
  });
}

describe("voided journal entries", () => {
  it("a legitimately voided entry still verifies, checkpointed or not", async () => {
    const { entry, chainEntry } = await postJournalEntry(ctx, "to be voided", 120);
    await runCheckpoint();
    expect((await verdictOf(chainEntry.id)).verdict).toBe("verified");

    await voidEntry(entry.id);
    expect((await verdictOf(chainEntry.id)).verdict).toBe("verified");

    await runCheckpoint();
    const reversingChain = await prisma.ledgerChain.findFirstOrThrow({
      where: { organisationId: ctx.organisationId },
      orderBy: { sequenceNumber: "desc" },
    });
    expect((await verdictOf(reversingChain.id)).verdict).toBe("verified");
  });

  it("a status flipped to VOID directly in the database, with no reversing entry, is flagged", async () => {
    const { entry, chainEntry } = await postJournalEntry(ctx, "fake void", 120);
    await runCheckpoint();
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: "VOID" } });

    const result = await verdictOf(chainEntry.id);
    expect(result.verdict).toBe("failed");
    expect(result.verdict === "pending" ? null : result.failureReason).toBe("hash_mismatch");
  });

  it("an amount changed on a voided entry is still flagged", async () => {
    const { entry, chainEntry } = await postJournalEntry(ctx, "void then tamper", 120);
    await runCheckpoint();
    await voidEntry(entry.id);
    const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: entry.id, debit: { gt: 0 } } });
    await prisma.journalLine.update({ where: { id: line.id }, data: { debit: 999 } });

    expect((await verdictOf(chainEntry.id)).verdict).toBe("failed");
  });
});

describe("report totals after a void", () => {
  /** Net debit minus credit per account, over the same status filter the report routes use. */
  async function netByAccount() {
    const lines = await prisma.journalLine.findMany({
      where: { journalEntry: { organisationId: ctx.organisationId, status: { in: [...COUNTED_ENTRY_STATUSES] } } },
    });
    const net = new Map<string, number>();
    for (const l of lines) net.set(l.accountId, (net.get(l.accountId) ?? 0) + Number(l.debit) - Number(l.credit));
    return net;
  }

  it("a voided entry and its reversing entry net to zero in every account", async () => {
    const { entry } = await postJournalEntry(ctx, "to be voided", 120);
    expect((await netByAccount()).get(ctx.expenseAccountId)).toBe(120);

    await voidEntry(entry.id);

    const net = await netByAccount();
    expect(net.get(ctx.expenseAccountId)).toBe(0);
    expect(net.get(ctx.cashAccountId)).toBe(0);
  });

  it("an unvoided entry is counted exactly once", async () => {
    await postJournalEntry(ctx, "kept", 75);
    const net = await netByAccount();
    expect(net.get(ctx.expenseAccountId)).toBe(75);
    expect(net.get(ctx.cashAccountId)).toBe(-75);
  });
});

describe("invoice lifecycle rows", () => {
  async function runInvoiceLifecycle(finalStatus: "PAID" | "VOIDED") {
    const invoice = await prisma.invoice.create({
      data: {
        organisationId: ctx.organisationId,
        customerName: "Lifecycle Customer",
        lineItems: { items: [{ description: "Work", quantity: 1, unitPrice: 250, incomeAccountId: ctx.expenseAccountId }], receivableAccountId: ctx.cashAccountId },
        amount: 250,
        status: "DRAFT",
        dueDate: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    const chainIds: string[] = [];
    const chain = async () => {
      const current = await prisma.invoice.findFirstOrThrow({ where: { id: invoice.id } });
      const row = await prisma.$transaction((tx) =>
        appendLedgerChainEntry(tx, {
          organisationId: ctx.organisationId,
          recordType: "INVOICE",
          recordId: invoice.id,
          fields: invoiceHashFields(current),
        })
      );
      chainIds.push(row.id);
    };

    await chain(); // DRAFT, chained when the invoice is created
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED" } });
    await chain(); // ISSUED
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    await chain(); // PAID
    if (finalStatus === "VOIDED") {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: "test" } });
      await chain(); // VOIDED
    }
    return { invoice, chainIds };
  }

  it.each(["PAID", "VOIDED"] as const)("every chain row of an invoice that ended %s verifies, before and after checkpointing", async (finalStatus) => {
    const { chainIds } = await runInvoiceLifecycle(finalStatus);
    for (const id of chainIds) expect((await verdictOf(id)).verdict).toBe("pending");

    await runCheckpoint();
    for (const id of chainIds) expect((await verdictOf(id)).verdict).toBe("verified");
  });

  it("altering the invoice amount flags every one of its chain rows", async () => {
    const { invoice, chainIds } = await runInvoiceLifecycle("VOIDED");
    await runCheckpoint();
    await prisma.invoice.update({ where: { id: invoice.id }, data: { amount: 1 } });

    for (const id of chainIds) expect((await verdictOf(id)).verdict).toBe("failed");
  });

  it("changing an invoice's status without a matching chain row is flagged", async () => {
    const { invoice, chainIds } = await runInvoiceLifecycle("PAID");
    await runCheckpoint();
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOIDED" } });

    expect((await verdictOf(chainIds[chainIds.length - 1])).verdict).toBe("failed");
  });
});
