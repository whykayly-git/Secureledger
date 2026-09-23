import { verifyLedgerChainEntryById, verifyChainContinuity } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Control trials — not counted in the 64-trial total. Prove the suite is
 * capable of returning "verified" / "intact" at all on untouched data, so
 * the 64 "failed"/"gaps found" verdicts above are meaningful rather than a
 * suite that always reports failure regardless of input.
 */
export async function runControlTrials(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("control-1-per-record");
      try {
        return await runTrial("control-1", "(control-1) Untouched, correctly checkpointed record", async () => {
          const a = await postJournalEntry(ctx, "Untouched control entry", 42);
          await runCheckpoint();
          const result = await verifyLedgerChainEntryById(a.chainEntry.id, ctx.organisationId);
          return {
            detected: result?.verdict === "verified",
            detail: `Verdict: ${result?.verdict} (expected "verified" — this trial passes when nothing is falsely flagged).`,
          };
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("control-2-continuity");
      try {
        return await runTrial(
          "control-2",
          "(control-2) Untouched 5-entry chain, mix of checkpointed and pending — continuity",
          async () => {
            for (let i = 0; i < 3; i++) await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i);
            await runCheckpoint();
            for (let i = 3; i < 5; i++) await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i);
            const result = await verifyChainContinuity(ctx.organisationId);
            return {
              detected: result.intact,
              detail: `Continuity intact: ${result.intact} (expected true — this trial passes when nothing is falsely flagged as a gap).`,
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
