import { prisma } from "@secureledger/db";
import { sha256Hex } from "@secureledger/crypto";
import { verifyLedgerChainEntryById, verifyChainContinuity } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (f) — Modification of a stored Merkle checkpoint/root (6 trials).
 *
 * merkleRoot tampering is caught by Part 1's existing per-record Merkle
 * inclusion check. rangeStart/rangeEnd/recordCount are informational
 * fields the ORIGINAL per-record check never looked at at all — closed
 * here by the new verifyChainContinuity's checkpoint count/range
 * cross-check (packages/verification/src/continuity.ts), added because
 * this category's own trials are exactly what exposed that a "range/count"
 * check was needed, not just a Merkle-inclusion check.
 */

export async function runMerkleTamperCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("f-1-root-single-leaf");
      try {
        return await runTrial("f-1", "(f-1) merkleRoot overwritten with garbage, single-leaf checkpoint", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
          await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { merkleRoot: sha256Hex("garbage-root-1") } });
          const result = await verifyLedgerChainEntryById(a.chainEntry.id, ctx.organisationId);
          return {
            detected: result?.verdict === "failed",
            detail: `Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("f-2-root-multi-leaf");
      try {
        return await runTrial("f-2", "(f-2) merkleRoot overwritten with garbage, 3-leaf checkpoint", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await runCheckpoint();
          const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
          await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { merkleRoot: sha256Hex("garbage-root-2") } });
          const result = await verifyLedgerChainEntryById(a.chainEntry.id, ctx.organisationId);
          return {
            detected: result?.verdict === "failed",
            detail: `Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("f-3-rangestart");
      try {
        return await runTrial("f-3", "(f-3) rangeStart altered directly on a checkpoint", async () => {
          await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
          await prisma.ledgerCheckpoint.update({
            where: { id: checkpoint.id },
            data: { rangeStart: new Date(checkpoint.rangeStart.getTime() - 60 * 60 * 1000) },
          });
          const continuity = await verifyChainContinuity(ctx.organisationId);
          return {
            detected: !continuity.intact,
            detail: `Continuity intact: ${continuity.intact}${continuity.gaps.length ? ` (${continuity.gaps.map((g) => g.type).join(", ")})` : ""}.`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("f-4-rangeend");
      try {
        return await runTrial("f-4", "(f-4) rangeEnd altered directly on a checkpoint", async () => {
          await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
          await prisma.ledgerCheckpoint.update({
            where: { id: checkpoint.id },
            data: { rangeEnd: new Date(checkpoint.rangeEnd.getTime() + 60 * 60 * 1000) },
          });
          const continuity = await verifyChainContinuity(ctx.organisationId);
          return {
            detected: !continuity.intact,
            detail: `Continuity intact: ${continuity.intact}${continuity.gaps.length ? ` (${continuity.gaps.map((g) => g.type).join(", ")})` : ""}.`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("f-5-recordcount-decreased");
      try {
        return await runTrial(
          "f-5",
          "(f-5) recordCount decreased directly on a checkpoint (without deleting any actual rows)",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            await postJournalEntry(ctx, "B", 20);
            await runCheckpoint();
            const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
            await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { recordCount: checkpoint.recordCount - 1 } });
            const continuity = await verifyChainContinuity(ctx.organisationId);
            return {
              detected: !continuity.intact,
              detail: `Continuity intact: ${continuity.intact}${continuity.gaps.length ? ` (${continuity.gaps.map((g) => g.type).join(", ")})` : ""}.`,
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
      const ctx = await createTestOrganisation("f-6-recordcount-increased");
      try {
        return await runTrial(
          "f-6",
          "(f-6) recordCount increased directly on a checkpoint (inflating its apparent coverage)",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            await runCheckpoint();
            const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId: ctx.organisationId } });
            await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { recordCount: checkpoint.recordCount + 5 } });
            const continuity = await verifyChainContinuity(ctx.organisationId);
            return {
              detected: !continuity.intact,
              detail: `Continuity intact: ${continuity.intact}${continuity.gaps.length ? ` (${continuity.gaps.map((g) => g.type).join(", ")})` : ""}.`,
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
