/**
 * Forged rows: a writer with database access who computes the hash correctly.
 *
 * The hash method is public, so such a row has a valid hash, a valid link to
 * the previous row and the next sequence number. The only thing it cannot have
 * is the keyed authentication tag. These tests insert rows exactly the way that
 * attacker would, straight through Prisma with no application code, and check
 * that the verifier flags them and the worker will not sign them.
 */
import { prisma } from "@secureledger/db";
import { computeChainAuthTag, computeChainHash } from "@secureledger/crypto";
import { journalEntryHashFields } from "@secureledger/ledger";
import { verifyLedgerChainEntryById, verifyOrganisation } from "@secureledger/verification";
import {
  createTestOrganisation,
  disconnectHarness,
  postJournalEntry,
  runCheckpoint,
  teardownOrganisation,
  TestOrgContext,
} from "../src/harness";

let ctx: TestOrgContext;
const realKey = process.env.LEDGER_AUTH_KEY;

const realStart = process.env.LEDGER_AUTH_START;
const restoreEnv = () => {
  process.env.LEDGER_AUTH_KEY = realKey;
  if (realStart === undefined) delete process.env.LEDGER_AUTH_START;
  else process.env.LEDGER_AUTH_START = realStart;
};

beforeEach(async () => {
  restoreEnv();
  ctx = await createTestOrganisation("forgery");
});
afterEach(async () => {
  restoreEnv();
  await teardownOrganisation(ctx.organisationId);
});
afterAll(async () => {
  await disconnectHarness();
});

/** Inserts a journal entry and a chain row the way a database-only attacker would. */
async function forgeEntry(authTag: string | null | "guess", amount = 5000) {
  const entry = await prisma.journalEntry.create({
    data: {
      organisationId: ctx.organisationId,
      date: new Date(),
      description: "Forged entry",
      status: "POSTED",
      createdById: ctx.userId,
      lines: {
        create: [
          { accountId: ctx.expenseAccountId, debit: amount, credit: 0 },
          { accountId: ctx.cashAccountId, debit: 0, credit: amount },
        ],
      },
    },
    include: { lines: true },
  });
  const tip = await prisma.ledgerChain.findFirstOrThrow({
    where: { organisationId: ctx.organisationId },
    orderBy: { sequenceNumber: "desc" },
  });
  const hash = computeChainHash(journalEntryHashFields(entry), tip.hash); // public method: correct
  const sequenceNumber = tip.sequenceNumber + 1;
  const base = { organisationId: ctx.organisationId, recordType: "JOURNAL_ENTRY", recordId: entry.id, sequenceNumber, hash };
  const chainRow = await prisma.ledgerChain.create({
    data: {
      organisationId: ctx.organisationId,
      recordType: "JOURNAL_ENTRY",
      recordId: entry.id,
      hash,
      previousHash: tip.hash,
      sequenceNumber,
      // an attacker without the key can only omit the tag or guess one
      authTag: authTag === "guess" ? computeChainAuthTag("an-attackers-best-guess-at-the-key-0000", base) : authTag,
    },
  });
  return { entry, chainRow };
}

describe("forged ledger rows", () => {
  it("accepts rows the application wrote, and verifies them", async () => {
    await postJournalEntry(ctx, "genuine", 10);
    await runCheckpoint();
    const v = await verifyOrganisation(ctx.organisationId, 5000);
    expect(v.counts).toEqual({ verified: 1, pending: 0, failed: 0 });
  });

  it("flags a forged row that has a correct hash and link but no tag", async () => {
    await postJournalEntry(ctx, "genuine", 10);
    const { chainRow } = await forgeEntry(null);

    const result = await verifyLedgerChainEntryById(chainRow.id, ctx.organisationId);
    expect(result).toMatchObject({ verdict: "failed", failureReason: "auth_tag_invalid" });
  });

  it("flags a forged row carrying a tag made with the wrong key", async () => {
    await postJournalEntry(ctx, "genuine", 10);
    const { chainRow } = await forgeEntry("guess");

    const result = await verifyLedgerChainEntryById(chainRow.id, ctx.organisationId);
    expect(result).toMatchObject({ verdict: "failed", failureReason: "auth_tag_invalid" });
  });

  it("shows the forged row as the only failure in Verify all", async () => {
    await postJournalEntry(ctx, "genuine one", 10);
    await postJournalEntry(ctx, "genuine two", 20);
    const { chainRow } = await forgeEntry(null);

    const v = await verifyOrganisation(ctx.organisationId, 5000);
    expect(v.counts.failed).toBe(1);
    expect(v.failures[0]).toMatchObject({ chainId: chainRow.id, failureReason: "auth_tag_invalid" });
  });

  it("makes the worker refuse to sign, so the forged row never receives a signature", async () => {
    await postJournalEntry(ctx, "genuine", 10);
    const { chainRow } = await forgeEntry(null);

    await runCheckpoint();

    const checkpoints = await prisma.ledgerCheckpoint.count({ where: { organisationId: ctx.organisationId } });
    const stillPending = await prisma.ledgerChain.count({ where: { organisationId: ctx.organisationId, checkpointId: null } });
    expect(checkpoints).toBe(0);
    expect(stillPending).toBe(2);
    expect((await prisma.ledgerChain.findUniqueOrThrow({ where: { id: chainRow.id } })).checkpointId).toBeNull();
  });

  it("does not let a forged row be slipped in after earlier rows were already signed", async () => {
    await postJournalEntry(ctx, "genuine", 10);
    await runCheckpoint();
    const { chainRow } = await forgeEntry(null);

    await runCheckpoint();

    expect(await prisma.ledgerCheckpoint.count({ where: { organisationId: ctx.organisationId } })).toBe(1);
    expect((await prisma.ledgerChain.findUniqueOrThrow({ where: { id: chainRow.id } })).checkpointId).toBeNull();
    expect((await verifyLedgerChainEntryById(chainRow.id, ctx.organisationId))?.verdict).toBe("failed");
  });

  it("flags a genuine row whose sequence number was changed", async () => {
    const { chainEntry } = await postJournalEntry(ctx, "genuine", 10);
    await prisma.ledgerChain.update({ where: { id: chainEntry.id }, data: { sequenceNumber: 99 } });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);
    expect(result).toMatchObject({ verdict: "failed", failureReason: "auth_tag_invalid" });
  });

  it("flags every row when an attacker strips all the tags to make the ledger look old", async () => {
    await postJournalEntry(ctx, "first", 10);
    await postJournalEntry(ctx, "second", 20);
    await prisma.ledgerChain.updateMany({ where: { organisationId: ctx.organisationId }, data: { authTag: null } });

    const v = await verifyOrganisation(ctx.organisationId, 5000);
    expect(v.counts.failed).toBe(2);
    await runCheckpoint();
    expect(await prisma.ledgerCheckpoint.count({ where: { organisationId: ctx.organisationId } })).toBe(0);
  });
});

describe("ledgers that predate tagging", () => {
  it("accepts untagged rows written before the key was introduced, and still catches a later forgery", async () => {
    delete process.env.LEDGER_AUTH_KEY;
    const old = await postJournalEntry(ctx, "written before tagging", 10);
    expect(old.chainEntry.authTag).toBeNull();

    await new Promise((r) => setTimeout(r, 20));
    process.env.LEDGER_AUTH_START = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    process.env.LEDGER_AUTH_KEY = realKey;
    const fresh = await postJournalEntry(ctx, "written after tagging", 20);
    expect(fresh.chainEntry.authTag).not.toBeNull();

    expect((await verifyLedgerChainEntryById(old.chainEntry.id, ctx.organisationId))?.verdict).toBe("pending");
    const { chainRow } = await forgeEntry(null);
    expect((await verifyLedgerChainEntryById(chainRow.id, ctx.organisationId))?.verdict).toBe("failed");

    await runCheckpoint();
    expect(await prisma.ledgerCheckpoint.count({ where: { organisationId: ctx.organisationId } })).toBe(0);
  });

  it("signs a legacy ledger normally when nothing has been forged", async () => {
    delete process.env.LEDGER_AUTH_KEY;
    await postJournalEntry(ctx, "legacy one", 10);
    await postJournalEntry(ctx, "legacy two", 20);

    await new Promise((r) => setTimeout(r, 20));
    process.env.LEDGER_AUTH_START = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    process.env.LEDGER_AUTH_KEY = realKey;
    await postJournalEntry(ctx, "tagged", 30);
    await runCheckpoint();

    const v = await verifyOrganisation(ctx.organisationId, 5000);
    expect(v.counts).toEqual({ verified: 3, pending: 0, failed: 0 });
  });
});
