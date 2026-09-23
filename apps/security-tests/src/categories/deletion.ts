import { prisma } from "@secureledger/db";
import { verifyChainContinuity } from "@secureledger/verification";
import {
  createTestOrganisation,
  postJournalEntry,
  runCheckpoint,
  runCheckpointWithInterval,
  sleep,
  teardownOrganisation,
} from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (b) — Deletion of a posted entry (10 trials).
 *
 * A cleanly DELETED LedgerChain row (no forged previousHash, nothing else
 * touched) leaves every surviving row internally self-consistent, so
 * per-record verifyLedgerChainEntryById has nothing to catch on any
 * SURVIVOR. Closed by the new organisation-wide verifyChainContinuity
 * (packages/verification/src/continuity.ts): sequence-number contiguity
 * catches gaps in the middle/start of the chain, and checkpoint
 * count/range cross-checks catch deletion of a checkpointed batch's own
 * tip. One trial (b-6) is a known, honest, undetected case: deleting the
 * single most-recent row of an organisation's chain before it has ever
 * been checkpointed leaves no trace anywhere in this schema.
 *
 * b-9/b-10 demonstrate that this is a CONFIGURABLE window, not a fixed
 * one: CHECKPOINT_MAX_INTERVAL_MS (apps/checkpoint-worker/src/config.ts)
 * bounds how long a record can sit uncheckpointed. Shrinking it shrinks
 * the window — it does not eliminate it, and this suite does not claim
 * otherwise. b-9 proves a deletion still inside a short (2s) window is
 * still invisible; b-10 proves the identical deletion, once the checkpoint
 * that same short interval triggers has actually run first, IS caught.
 */

const SHORT_CHECKPOINT_INTERVAL_MS = 2000;

async function detectedResult(organisationId: string) {
  const result = await verifyChainContinuity(organisationId);
  return {
    detected: !result.intact,
    detail: result.intact
      ? "verifyChainContinuity reported the chain intact (no gaps found)."
      : `verifyChainContinuity found ${result.gaps.length} gap(s): ${result.gaps.map((g) => g.type).join(", ")}.`,
  };
}

export async function runDeletionCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-1-mid-pending");
      try {
        return await runTrial("b-1", "(b-1) Delete middle row of a 3-entry chain, pending (not checkpointed)", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await prisma.ledgerChain.delete({ where: { id: b.chainEntry.id } });
          return detectedResult(ctx.organisationId);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-2-mid-checkpointed");
      try {
        return await runTrial("b-2", "(b-2) Delete middle row of a 3-entry chain, checkpointed", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await runCheckpoint();
          await prisma.ledgerChain.delete({ where: { id: b.chainEntry.id } });
          return detectedResult(ctx.organisationId);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-3-genesis-pending");
      try {
        return await runTrial("b-3", "(b-3) Delete the genesis (first) row, pending", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await postJournalEntry(ctx, "B", 20);
          await prisma.ledgerChain.delete({ where: { id: a.chainEntry.id } });
          return detectedResult(ctx.organisationId);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-4-genesis-checkpointed");
      try {
        return await runTrial("b-4", "(b-4) Delete the genesis (first) row, checkpointed", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          await postJournalEntry(ctx, "B", 20);
          await runCheckpoint();
          await prisma.ledgerChain.delete({ where: { id: a.chainEntry.id } });
          return detectedResult(ctx.organisationId);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-5-tip-checkpointed");
      try {
        return await runTrial("b-5", "(b-5) Delete the tip row of a checkpointed batch", async () => {
          await postJournalEntry(ctx, "A", 10);
          await postJournalEntry(ctx, "B", 20);
          const c = await postJournalEntry(ctx, "C", 30);
          await runCheckpoint();
          await prisma.ledgerChain.delete({ where: { id: c.chainEntry.id } });
          return detectedResult(ctx.organisationId);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-6-tip-pending");
      try {
        return await runTrial(
          "b-6",
          "(b-6) Delete the tip row that is NOT yet checkpointed (known, honest limitation)",
          async () => {
            await postJournalEntry(ctx, "A", 10);
            await runCheckpoint(); // checkpoints only A
            const b = await postJournalEntry(ctx, "B", 20); // never checkpointed
            await prisma.ledgerChain.delete({ where: { id: b.chainEntry.id } });
            return detectedResult(ctx.organisationId);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-7-mid-of-5-checkpointed");
      try {
        return await runTrial(
          "b-7",
          "(b-7) Delete a middle row of a 5-entry chain, checkpointed as one batch",
          async () => {
            const posted = [];
            for (let i = 0; i < 5; i++) posted.push(await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i));
            await runCheckpoint();
            await prisma.ledgerChain.delete({ where: { id: posted[2].chainEntry.id } });
            return detectedResult(ctx.organisationId);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-8-two-nonadjacent");
      try {
        return await runTrial(
          "b-8",
          "(b-8) Delete two non-adjacent rows (positions 2 and 4) of a 5-entry checkpointed chain",
          async () => {
            const posted = [];
            for (let i = 0; i < 5; i++) posted.push(await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i));
            await runCheckpoint();
            await prisma.ledgerChain.delete({ where: { id: posted[1].chainEntry.id } });
            await prisma.ledgerChain.delete({ where: { id: posted[3].chainEntry.id } });
            return detectedResult(ctx.organisationId);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-9-within-short-window");
      try {
        return await runTrial(
          "b-9",
          `(b-9) Delete a record well inside a configured ${SHORT_CHECKPOINT_INTERVAL_MS}ms checkpoint window (known, honest limitation — the window is smaller, not gone)`,
          async () => {
            await postJournalEntry(ctx, "A", 10);
            // Establishes lastCheckpointAt for this org (decideCheckpoint
            // always checkpoints immediately on an org's first-ever cycle,
            // regardless of maxIntervalMs — see harness.ts) so the SECOND
            // cycle below genuinely exercises the configured interval.
            await runCheckpointWithInterval(SHORT_CHECKPOINT_INTERVAL_MS);
            const b = await postJournalEntry(ctx, "B", 20);
            // Deleted almost immediately — well under the 2s window.
            await prisma.ledgerChain.delete({ where: { id: b.chainEntry.id } });
            // Elapsed time since lastCheckpointAt is still tiny, so this
            // cycle correctly declines to checkpoint (nothing to commit to
            // anyway — B no longer exists).
            await runCheckpointWithInterval(SHORT_CHECKPOINT_INTERVAL_MS);
            return detectedResult(ctx.organisationId);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("b-10-after-short-window");
      try {
        return await runTrial(
          "b-10",
          `(b-10) Delete a record after the configured ${SHORT_CHECKPOINT_INTERVAL_MS}ms checkpoint window has actually elapsed and run`,
          async () => {
            await postJournalEntry(ctx, "A", 10);
            await runCheckpointWithInterval(SHORT_CHECKPOINT_INTERVAL_MS);
            const b = await postJournalEntry(ctx, "B", 20);
            // Real wall-clock wait past the configured interval, then a
            // real checkpoint cycle — this is the same timer a deployment
            // with CHECKPOINT_MAX_INTERVAL_MS set this low would see, not
            // a forced/simulated checkpoint.
            await sleep(SHORT_CHECKPOINT_INTERVAL_MS + 800);
            await runCheckpointWithInterval(SHORT_CHECKPOINT_INTERVAL_MS);
            // B is now checkpointed. Deleting it after the fact breaks
            // that checkpoint's recordCount/range — the same mechanism
            // b-5 exercises, just reached via real elapsed time instead of
            // a forced checkpoint.
            await prisma.ledgerChain.delete({ where: { id: b.chainEntry.id } });
            return detectedResult(ctx.organisationId);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  return results;
}
