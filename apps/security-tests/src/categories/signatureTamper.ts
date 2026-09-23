import { prisma } from "@secureledger/db";
import { generateSigningKeyPair, signRoot } from "@secureledger/crypto";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (g) — Substitution of an invalid/mismatched signature (6 trials).
 *
 * All closed by Part 1's existing, unmodified signature check
 * (verifyRootSignature against the fixed CHECKPOINT_PUBLIC_KEY), which
 * gracefully returns false rather than throwing on malformed input (see
 * packages/crypto/src/sign.ts), so every substitution variant here —
 * wrong key, empty, malformed, or a real signature reused from a
 * different root — should report signature_invalid.
 */

async function checkpointFor(organisationId: string) {
  return prisma.ledgerCheckpoint.findFirstOrThrow({ where: { organisationId } });
}

export async function runSignatureTamperCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("g-1-impostor-key");
      try {
        return await runTrial("g-1", "(g-1) signature replaced with a validly-formed signature from a different key pair", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await checkpointFor(ctx.organisationId);
          const impostor = generateSigningKeyPair();
          const forged = signRoot(checkpoint.merkleRoot, impostor.privateKey);
          await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { signature: forged } });
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
      const ctx = await createTestOrganisation("g-2-empty-signature");
      try {
        return await runTrial("g-2", "(g-2) signature replaced with an empty string", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await checkpointFor(ctx.organisationId);
          await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { signature: "" } });
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
      const ctx = await createTestOrganisation("g-3-malformed-signature");
      try {
        return await runTrial("g-3", "(g-3) signature replaced with random malformed base64 garbage", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await checkpointFor(ctx.organisationId);
          await prisma.ledgerCheckpoint.update({ where: { id: checkpoint.id }, data: { signature: "not-a-real-signature-!!!===" } });
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
      const ctx = await createTestOrganisation("g-4-reused-same-org-signature");
      try {
        return await runTrial(
          "g-4",
          "(g-4) signature swapped with another real, valid signature from a DIFFERENT checkpoint in the same organisation",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            await runCheckpoint();
            const first = await checkpointFor(ctx.organisationId);
            await postJournalEntry(ctx, "B", 20);
            await runCheckpoint();
            const second = await prisma.ledgerCheckpoint.findFirstOrThrow({
              where: { organisationId: ctx.organisationId, id: { not: first.id } },
            });
            await prisma.ledgerCheckpoint.update({ where: { id: first.id }, data: { signature: second.signature } });
            const result = await verifyLedgerChainEntryById(a.chainEntry.id, ctx.organisationId);
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
      const ctxA = await createTestOrganisation("g-5-cross-org-a");
      const ctxB = await createTestOrganisation("g-5-cross-org-b");
      try {
        return await runTrial(
          "g-5",
          "(g-5) signature swapped with a real, valid signature from a DIFFERENT organisation's checkpoint",
          async () => {
            const a = await postJournalEntry(ctxA, "A", 10);
            await runCheckpoint();
            const checkpointA = await checkpointFor(ctxA.organisationId);

            await postJournalEntry(ctxB, "B", 20);
            await runCheckpoint();
            const checkpointB = await checkpointFor(ctxB.organisationId);

            await prisma.ledgerCheckpoint.update({ where: { id: checkpointA.id }, data: { signature: checkpointB.signature } });
            const result = await verifyLedgerChainEntryById(a.chainEntry.id, ctxA.organisationId);
            return {
              detected: result?.verdict === "failed",
              detail: `Verdict: ${result?.verdict}, failureReason: ${result && "failureReason" in result ? result.failureReason : "n/a"}.`,
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
      const ctx = await createTestOrganisation("g-6-truncated-signature");
      try {
        return await runTrial("g-6", "(g-6) signature truncated (a real signature, sliced short)", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await runCheckpoint();
          const checkpoint = await checkpointFor(ctx.organisationId);
          await prisma.ledgerCheckpoint.update({
            where: { id: checkpoint.id },
            data: { signature: checkpoint.signature.slice(0, Math.floor(checkpoint.signature.length / 2)) },
          });
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

  return results;
}
