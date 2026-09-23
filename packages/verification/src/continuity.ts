import { prisma } from "@secureledger/db";

export type ContinuityGapType =
  | "sequence_gap"
  | "hash_link_mismatch"
  | "checkpoint_count_mismatch"
  | "checkpoint_range_mismatch";

export type ContinuityGap = {
  type: ContinuityGapType;
  chainId?: string;
  checkpointId?: string;
  detail: string;
};

export type ChainContinuityResult = {
  organisationId: string;
  totalRows: number;
  intact: boolean;
  gaps: ContinuityGap[];
};

/**
 * Organisation-wide sweep that per-record verification cannot do on its
 * own: it proves nothing is MISSING from the chain, not just that every
 * surviving row is internally consistent.
 *
 * A cleanly deleted LedgerChain row (no forged previousHash, no altered
 * hash — the row is just gone) leaves every remaining row's own hash and
 * previousHash fields perfectly self-consistent, so
 * verifyLedgerChainEntryById has nothing to catch on any of the survivors
 * individually. Two independent, organisation-wide checks close that gap:
 *
 * 1. Sequence contiguity — sequenceNumber is assigned 1, 2, 3, ... at write
 *    time (see appendLedgerChainEntry), independently of the mutable
 *    createdAt column. Walking a chain's rows ordered by sequenceNumber and
 *    finding anything other than an unbroken 1..N run means a row was
 *    deleted from the middle (or the start) of the chain.
 * 2. Checkpoint count/range cross-check — recordCount and rangeStart/
 *    rangeEnd are captured once, at checkpoint-creation time, from the
 *    exact batch that was Merkle-tree-signed. Comparing recordCount (and
 *    the actual min/max createdAt) against what the checkpoint's rows
 *    currently look like on disk catches deletion of the checkpoint
 *    batch's OWN tip — the one position sequence contiguity alone can't
 *    reveal, because nothing after it exists to expose the gap.
 *
 * Known, honest limitation (not closed by this function, or by anything
 * else in the codebase): deleting the single most-recently-appended row of
 * an organisation's chain, before it has ever been checkpointed, leaves no
 * trace anywhere — no surviving row references it, and no checkpoint has
 * committed to its existence. Nothing short of an external, independent
 * commitment made at write time (outside this database, so the same
 * attacker with DB access can't erase it too) closes that specific case.
 */
export async function verifyChainContinuity(organisationId: string): Promise<ChainContinuityResult> {
  const rows = await prisma.ledgerChain.findMany({
    where: { organisationId },
    orderBy: { sequenceNumber: "asc" },
    select: { id: true, sequenceNumber: true, hash: true, previousHash: true, checkpointId: true, createdAt: true },
  });

  const gaps: ContinuityGap[] = [];

  for (let i = 0; i < rows.length; i++) {
    const expectedSequence = i + 1;
    if (rows[i].sequenceNumber !== expectedSequence) {
      gaps.push({
        type: "sequence_gap",
        chainId: rows[i].id,
        detail: `Expected sequenceNumber ${expectedSequence} at chain position ${i}, found ${rows[i].sequenceNumber} (row ${rows[i].id}) — a row appears to be missing between sequence ${expectedSequence - 1} and ${rows[i].sequenceNumber}.`,
      });
    }
  }

  let priorHash: string | null = null;
  for (const row of rows) {
    if (row.previousHash !== priorHash) {
      gaps.push({
        type: "hash_link_mismatch",
        chainId: row.id,
        detail: `Chain row ${row.id} (sequence ${row.sequenceNumber}) has previousHash that does not equal the hash of the row immediately preceding it in the surviving sequence.`,
      });
    }
    priorHash = row.hash;
  }

  const checkpoints = await prisma.ledgerCheckpoint.findMany({
    where: { organisationId },
    select: { id: true, recordCount: true, rangeStart: true, rangeEnd: true },
  });

  for (const cp of checkpoints) {
    const coveredRows = rows.filter((r) => r.checkpointId === cp.id);
    const actualCount = coveredRows.length;

    if (actualCount !== cp.recordCount) {
      gaps.push({
        type: "checkpoint_count_mismatch",
        checkpointId: cp.id,
        detail: `Checkpoint ${cp.id} originally covered ${cp.recordCount} record(s) but only ${actualCount} LedgerChain row(s) referencing it exist now — ${cp.recordCount - actualCount} appear to have been deleted.`,
      });
    }

    if (coveredRows.length > 0) {
      const actualRangeStart = coveredRows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), coveredRows[0].createdAt);
      const actualRangeEnd = coveredRows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), coveredRows[0].createdAt);

      if (actualRangeStart.getTime() !== cp.rangeStart.getTime() || actualRangeEnd.getTime() !== cp.rangeEnd.getTime()) {
        gaps.push({
          type: "checkpoint_range_mismatch",
          checkpointId: cp.id,
          detail: `Checkpoint ${cp.id} recorded range [${cp.rangeStart.toISOString()}, ${cp.rangeEnd.toISOString()}] but its surviving rows now span [${actualRangeStart.toISOString()}, ${actualRangeEnd.toISOString()}].`,
        });
      }
    }
  }

  return {
    organisationId,
    totalRows: rows.length,
    intact: gaps.length === 0,
    gaps,
  };
}
