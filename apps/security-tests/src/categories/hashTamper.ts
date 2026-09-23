import { prisma } from "@secureledger/db";
import { sha256Hex, computeChainHash } from "@secureledger/crypto";
import { journalEntryHashFields } from "@secureledger/ledger";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (e) — Direct modification of a stored hash-chain value (8 trials).
 *
 * Directly overwrites LedgerChain.hash or LedgerChain.previousHash via
 * Prisma, at various positions and checkpoint states. All closed by Part
 * 1's hash-recompute check, which runs before the checkpoint-dependent
 * checks and so fires regardless of checkpoint status: altering `hash`
 * alone always produces a mismatch against the freshly recomputed value;
 * altering `previousHash` alone does too (it's an input to the stored
 * hash); only a previousHash forgery that ALSO recomputes a
 * self-consistent hash slips past hash-recompute and is instead caught by
 * the chain-link continuity check.
 */

async function verdictOf(chainId: string, organisationId: string) {
  const result = await verifyLedgerChainEntryById(chainId, organisationId);
  return {
    detected: result?.verdict === "failed",
    verdict: result?.verdict,
    failureReason: result && "failureReason" in result ? result.failureReason : undefined,
  };
}

export async function runHashTamperCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-1-hash-single-pending");
      try {
        return await runTrial("e-1", "(e-1) hash overwritten with garbage, sole entry, pending", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await prisma.ledgerChain.update({ where: { id: a.chainEntry.id }, data: { hash: sha256Hex("garbage-1") } });
          const v = await verdictOf(a.chainEntry.id, ctx.organisationId);
          return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-2-hash-single-checkpointed");
      try {
        return await runTrial("e-2", "(e-2) hash overwritten with garbage, sole entry, checkpointed", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          await prisma.ledgerChain.update({ where: { id: a.chainEntry.id }, data: { hash: sha256Hex("garbage-2") } });
          const v = await verdictOf(a.chainEntry.id, ctx.organisationId);
          return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-3-hash-mid-pending");
      try {
        return await runTrial("e-3", "(e-3) hash overwritten with garbage, middle of 3-entry chain, pending", async () => {
          await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await prisma.ledgerChain.update({ where: { id: b.chainEntry.id }, data: { hash: sha256Hex("garbage-3") } });
          const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
          return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-4-hash-mid-checkpointed");
      try {
        return await runTrial("e-4", "(e-4) hash overwritten with garbage, middle of 3-entry chain, checkpointed", async () => {
          await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await runCheckpoint();
          await prisma.ledgerChain.update({ where: { id: b.chainEntry.id }, data: { hash: sha256Hex("garbage-4") } });
          const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
          return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-5-prevhash-naive-pending");
      try {
        return await runTrial(
          "e-5",
          "(e-5) previousHash overwritten with a forged value (naive, hash NOT recomputed to match), pending",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: sha256Hex("forged-predecessor-5") },
            });
            const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
            return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-6-prevhash-sophisticated-pending");
      try {
        return await runTrial(
          "e-6",
          "(e-6) previousHash forged AND hash recomputed to match it (sophisticated, self-consistent), pending",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            const forgedPreviousHash = sha256Hex("forged-predecessor-6");
            const recomputedHash = computeChainHash(journalEntryHashFields(b.entry), forgedPreviousHash);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: forgedPreviousHash, hash: recomputedHash },
            });
            const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
            return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-7-prevhash-sophisticated-checkpointed");
      try {
        return await runTrial(
          "e-7",
          "(e-7) previousHash forged AND hash recomputed to match it (sophisticated), checkpointed",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            await runCheckpoint();
            const forgedPreviousHash = sha256Hex("forged-predecessor-7");
            const recomputedHash = computeChainHash(journalEntryHashFields(b.entry), forgedPreviousHash);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: forgedPreviousHash, hash: recomputedHash },
            });
            const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
            return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("e-8-both-fully-fabricated");
      try {
        return await runTrial(
          "e-8",
          "(e-8) both hash and previousHash overwritten with a mutually-consistent but unrelated fabricated pair",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            const forgedPreviousHash = sha256Hex("forged-predecessor-8");
            const fabricatedHash = computeChainHash({ made: "up", data: "entirely" }, forgedPreviousHash);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: forgedPreviousHash, hash: fabricatedHash },
            });
            const v = await verdictOf(b.chainEntry.id, ctx.organisationId);
            return { detected: v.detected, detail: `Verdict: ${v.verdict}, failureReason: ${v.failureReason}.` };
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  return results;
}
