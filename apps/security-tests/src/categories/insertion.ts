import { prisma, PrismaClient } from "@secureledger/db";
import { sha256Hex, computeChainHash } from "@secureledger/crypto";
import { journalEntryHashFields } from "@secureledger/ledger";
import { verifyLedgerChainEntryById, verifyChainContinuity } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation, TestOrgContext } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (c) — Insertion of an unauthorised entry (8 trials).
 *
 * Directly INSERTs a new LedgerChain row via Prisma, bypassing
 * appendLedgerChainEntry entirely (so the attacker must forge whatever
 * hash/previousHash/sequenceNumber they want by hand). Explores the real
 * range of attacker sophistication: from "no backing record at all" up to
 * "computed everything correctly" — and is honest that the top of that
 * range is fundamentally indistinguishable from a legitimate write, which
 * is a property of hash chains generally, not a bug in this codebase.
 */

async function makeFakeJournalEntry(ctx: TestOrgContext, description: string) {
  return prisma.journalEntry.create({
    data: {
      organisationId: ctx.organisationId,
      date: new Date(),
      description,
      status: "POSTED",
      createdById: ctx.userId,
      lines: {
        create: [
          { accountId: ctx.expenseAccountId, debit: 999, credit: 0 },
          { accountId: ctx.cashAccountId, debit: 0, credit: 999 },
        ],
      },
    },
    include: { lines: true },
  });
}

async function currentTip(organisationId: string) {
  return prisma.ledgerChain.findFirst({
    where: { organisationId },
    orderBy: { sequenceNumber: "desc" },
  });
}

export async function runInsertionCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-1-naive-no-backing");
      try {
        return await runTrial("c-1", "(c-1) Insert with no backing JournalEntry at all, far-future sequence number", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const fake = await prisma.ledgerChain.create({
            data: {
              organisationId: ctx.organisationId,
              recordType: "JOURNAL_ENTRY",
              recordId: sha256Hex("nonexistent-record").slice(0, 36),
              hash: sha256Hex("fake-hash"),
              previousHash: a.chainEntry.hash,
              sequenceNumber: 9001,
            },
          });
          const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
          return {
            detected: result?.verdict === "failed",
            detail: `Inserted fabricated LedgerChain row ${fake.id} with recordId pointing to nothing. Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-2-fake-entry-wrong-prevhash");
      try {
        return await runTrial(
          "c-2",
          "(c-2) Insert with a real fake JournalEntry, self-consistent hash, but wrong previousHash",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const fakeEntry = await makeFakeJournalEntry(ctx, "Fabricated bonus payment");
            const wrongPreviousHash = sha256Hex("wrong-predecessor");
            const hash = computeChainHash(journalEntryHashFields(fakeEntry), wrongPreviousHash);
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctx.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: fakeEntry.id,
                hash,
                previousHash: wrongPreviousHash,
                sequenceNumber: 9002,
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Inserted self-consistent fake row ${fake.id} (own hash matches own fields+previousHash) but previousHash does not match any real predecessor. Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctxA = await createTestOrganisation("c-3-cross-tenant-a");
      const ctxB = await createTestOrganisation("c-3-cross-tenant-b");
      try {
        return await runTrial(
          "c-3",
          "(c-3) Insert in Org A's chain referencing a real JournalEntry that actually belongs to Org B",
          async () => {
            const realInOrgB = await postJournalEntry(ctxB, "Org B's real entry", 250);
            const tipA = await currentTip(ctxA.organisationId);
            const previousHash = tipA?.hash ?? null;
            // recomputeStoredHash (packages/verification/src/verify.ts) now
            // scopes the JournalEntry/Invoice lookup by organisationId, not
            // just recordId — so a hash computed correctly from Org B's REAL
            // fields no longer recomputes successfully once inserted into Org
            // A's chain, because the scoped lookup for Org A simply finds no
            // such record.
            const hash = computeChainHash(journalEntryHashFields(realInOrgB.entry), previousHash);
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctxA.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: realInOrgB.entry.id,
                hash,
                previousHash,
                sequenceNumber: (tipA?.sequenceNumber ?? 0) + 1,
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctxA.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Inserted row ${fake.id} into Org A's chain, correctly hashed and chained, but recordId points to a real JournalEntry that belongs to Org B. Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}. recomputeStoredHash now scopes its lookup by organisationId, so the cross-tenant record is invisible to Org A's verification and the hash never recomputes.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctxA.organisationId);
        await teardownOrganisation(ctxB.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-4-wrong-hash");
      try {
        return await runTrial(
          "c-4",
          "(c-4) Insert with a real fake JournalEntry and correct previousHash, but a wrong (unrecomputed) hash",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            const fakeEntry = await makeFakeJournalEntry(ctx, "Fabricated refund");
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctx.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: fakeEntry.id,
                hash: sha256Hex("attacker-did-not-recompute-this-correctly"),
                previousHash: a.chainEntry.hash,
                sequenceNumber: 9004,
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Inserted row ${fake.id} with correct previousHash but a hash that doesn't recompute from the fake entry's real fields. Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-5-fully-correct-tip-append");
      try {
        return await runTrial(
          "c-5",
          "(c-5) Insert appended at the tip with a fully correct hash/previousHash/sequenceNumber (known, honest limitation)",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const tip = await currentTip(ctx.organisationId);
            const fakeEntry = await makeFakeJournalEntry(ctx, "Fabricated but perfectly-chained transaction");
            const hash = computeChainHash(journalEntryHashFields(fakeEntry), tip!.hash);
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctx.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: fakeEntry.id,
                hash,
                previousHash: tip!.hash,
                sequenceNumber: tip!.sequenceNumber + 1,
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
            const continuity = await verifyChainContinuity(ctx.organisationId);
            return {
              detected: result?.verdict === "failed" || !continuity.intact,
              detail: `Inserted row ${fake.id} with a genuinely correctly-computed hash, previousHash, and sequenceNumber matching what a real append would produce. Verdict: ${result?.verdict}. Continuity intact: ${continuity.intact}. This is not a bounded gap in the verification logic — a raw-DB attacker who correctly computes every chained field produces data that IS a valid chain; only the write path's authentication/authorization (JWT + RBAC on /api routes) prevents this in production, not the read-side integrity checks.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-6-no-backing-tip");
      try {
        return await runTrial(
          "c-6",
          "(c-6) Insert at the tip with correct previousHash/sequenceNumber but no backing JournalEntry",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const tip = await currentTip(ctx.organisationId);
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctx.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: sha256Hex("no-such-entry").slice(0, 36),
                hash: sha256Hex("plausible-looking-hash"),
                previousHash: tip!.hash,
                sequenceNumber: tip!.sequenceNumber + 1,
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Inserted row ${fake.id} at the tip with correct chain-position fields but recordId pointing to nothing. Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-7-duplicate-recordid");
      try {
        return await runTrial(
          "c-7",
          "(c-7) Insert a second, fully-chained LedgerChain row duplicating an existing unchanged JournalEntry's recordId",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            const tip = await currentTip(ctx.organisationId);
            const hash = computeChainHash(journalEntryHashFields(a.entry), tip!.hash);
            // Deliberately isolated to its own short-lived connection: a
            // unique-constraint violation on this project's PGlite dev
            // database can take down the whole underlying wire-protocol
            // connection (not just the one query), which would otherwise
            // poison the shared client every other trial in this suite
            // depends on. See the (now-superseded) c-3 sequence-collision
            // approach this pattern was first used for.
            const isolatedClient = new PrismaClient();
            try {
              try {
                await isolatedClient.ledgerChain.create({
                  data: {
                    organisationId: ctx.organisationId,
                    recordType: "JOURNAL_ENTRY",
                    recordId: a.entry.id, // duplicate reference to the SAME, unaltered real entry
                    hash,
                    previousHash: tip!.hash,
                    sequenceNumber: tip!.sequenceNumber + 1,
                  },
                });
                return {
                  detected: false,
                  detail: `Duplicate insert for JournalEntry ${a.entry.id} unexpectedly succeeded — the partial unique index (organisationId, recordId) WHERE recordType = 'JOURNAL_ENTRY' did not reject it.`,
                };
              } catch (err) {
                return {
                  detected: true,
                  detail: `Insert rejected outright by the database's partial unique index on (organisationId, recordId) WHERE recordType = 'JOURNAL_ENTRY': ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
                };
              }
            } finally {
              await isolatedClient.$disconnect();
            }
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("c-8-midchain-wrong-position");
      try {
        return await runTrial(
          "c-8",
          "(c-8) Insert reusing a mid-chain row's hash as previousHash, but placed far out of position",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            await postJournalEntry(ctx, "B", 20);
            await postJournalEntry(ctx, "C", 30);
            const fakeEntry = await makeFakeJournalEntry(ctx, "Spliced fake entry");
            const hash = computeChainHash(journalEntryHashFields(fakeEntry), a.chainEntry.hash);
            const fake = await prisma.ledgerChain.create({
              data: {
                organisationId: ctx.organisationId,
                recordType: "JOURNAL_ENTRY",
                recordId: fakeEntry.id,
                hash,
                previousHash: a.chainEntry.hash, // claims to follow row A (position 1)
                sequenceNumber: 9008, // but is placed far out of position, not position 2
              },
            });
            const result = await verifyLedgerChainEntryById(fake.id, ctx.organisationId);
            const continuity = await verifyChainContinuity(ctx.organisationId);
            return {
              detected: result?.verdict === "failed" || !continuity.intact,
              detail: `Inserted row ${fake.id} claiming (via previousHash) to follow row A, but placed at sequence 9008 instead of the real next position. Verdict: ${result?.verdict}. Continuity intact: ${continuity.intact}.`,
            };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  return results;
}
