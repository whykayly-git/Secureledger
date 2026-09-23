import { prisma } from "@secureledger/db";
import { sha256Hex, computeChainHash } from "@secureledger/crypto";
import { journalEntryHashFields } from "@secureledger/ledger";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (h) — Alteration before vs. after checkpointing (6 trials).
 *
 * Directly exercises the property Part 1's fix was specifically required
 * to have: the hash-recompute and chain-link checks run on EVERY verdict
 * path, not gated behind "already checkpointed". Three tamper types
 * (amount, hash, sophisticated previousHash forgery), each applied once
 * to a still-pending record and once to an already-checkpointed one, to
 * directly demonstrate that timing relative to checkpointing changes
 * nothing about detection.
 */

export async function runTimingCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("h-1-amount-before");
      try {
        return await runTrial("h-1", "(h-1) amount tampered BEFORE checkpointing (record still pending)", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: a.entry.id, debit: { gt: 0 } } });
          await prisma.journalLine.update({ where: { id: line.id }, data: { debit: 777.77 } });
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
      const ctx = await createTestOrganisation("h-2-amount-after");
      try {
        return await runTrial("h-2", "(h-2) amount tampered AFTER checkpointing", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: a.entry.id, debit: { gt: 0 } } });
          await prisma.journalLine.update({ where: { id: line.id }, data: { debit: 888.88 } });
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
      const ctx = await createTestOrganisation("h-3-hash-before");
      try {
        return await runTrial("h-3", "(h-3) stored hash overwritten BEFORE checkpointing (record still pending)", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await prisma.ledgerChain.update({ where: { id: a.chainEntry.id }, data: { hash: sha256Hex("garbage-h3") } });
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
      const ctx = await createTestOrganisation("h-4-hash-after");
      try {
        return await runTrial("h-4", "(h-4) stored hash overwritten AFTER checkpointing", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          await prisma.ledgerChain.update({ where: { id: a.chainEntry.id }, data: { hash: sha256Hex("garbage-h4") } });
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
      const ctx = await createTestOrganisation("h-5-prevhash-before");
      try {
        return await runTrial(
          "h-5",
          "(h-5) sophisticated self-consistent previousHash forgery BEFORE checkpointing (record still pending)",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            const forgedPreviousHash = sha256Hex("forged-h5");
            const recomputedHash = computeChainHash(journalEntryHashFields(b.entry), forgedPreviousHash);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: forgedPreviousHash, hash: recomputedHash },
            });
            const result = await verifyLedgerChainEntryById(b.chainEntry.id, ctx.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
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
      const ctx = await createTestOrganisation("h-6-prevhash-after");
      try {
        return await runTrial(
          "h-6",
          "(h-6) sophisticated self-consistent previousHash forgery AFTER checkpointing",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            await runCheckpoint();
            const forgedPreviousHash = sha256Hex("forged-h6");
            const recomputedHash = computeChainHash(journalEntryHashFields(b.entry), forgedPreviousHash);
            await prisma.ledgerChain.update({
              where: { id: b.chainEntry.id },
              data: { previousHash: forgedPreviousHash, hash: recomputedHash },
            });
            const result = await verifyLedgerChainEntryById(b.chainEntry.id, ctx.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
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
