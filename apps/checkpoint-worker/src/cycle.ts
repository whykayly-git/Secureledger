import type { PrismaClient } from "@secureledger/db";
import { getLedgerAuthKey, judgeChainRow } from "@secureledger/ledger";
import { buildCheckpointPayload, decideCheckpoint } from "./checkpoint";
import { logger } from "./logger";

export type CycleOptions = {
  batchThreshold: number;
  maxIntervalMs: number;
  privateKeyPem: string;
};

/**
 * Runs one full checkpoint cycle: for every organisation with at least one
 * uncheckpointed LedgerChain row, decide whether it's due (row-count
 * threshold or time-elapsed threshold), and if so build + persist a
 * LedgerCheckpoint covering exactly those rows.
 */
export async function runCheckpointCycle(prisma: PrismaClient, options: CycleOptions): Promise<void> {
  const now = new Date();

  const pendingGroups = await prisma.ledgerChain.groupBy({
    by: ["organisationId"],
    where: { checkpointId: null },
    _count: { _all: true },
  });

  if (pendingGroups.length === 0) {
    logger.info("No organisations have pending ledger entries this cycle");
    return;
  }

  for (const group of pendingGroups) {
    const organisationId = group.organisationId;
    const pendingCount = group._count._all;

    const lastCheckpoint = await prisma.ledgerCheckpoint.findFirst({
      where: { organisationId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const decision = decideCheckpoint({
      pendingCount,
      lastCheckpointAt: lastCheckpoint?.createdAt ?? null,
      now,
      batchThreshold: options.batchThreshold,
      maxIntervalMs: options.maxIntervalMs,
    });

    if (!decision.shouldCheckpoint) {
      continue;
    }

    try {
      // Cap the batch at batchThreshold * 4 per cycle so one org can't starve others
      // if it has fallen far behind; remaining rows get picked up next cycle.
      const rows = await prisma.ledgerChain.findMany({
        where: { organisationId, checkpointId: null },
        orderBy: { createdAt: "asc" },
        take: options.batchThreshold * 4,
        select: {
          id: true,
          hash: true,
          createdAt: true,
          organisationId: true,
          recordType: true,
          recordId: true,
          sequenceNumber: true,
          authTag: true,
        },
      });

      // A signature means "this was in the database when signed", so the worker
      // must first be sure the application wrote every row it is about to sign.
      // The hash method is public, so a row inserted straight into the database
      // can carry a perfectly valid hash and link; only the keyed tag tells it
      // apart. One bad row blocks the whole batch: the Merkle tree and the
      // checkpoint's record count both cover it, so it cannot be left out.
      if (getLedgerAuthKey()) {
        const rejected = rows.filter((r) => {
          const status = judgeChainRow(r);
          return status === "missing" || status === "invalid";
        });
        if (rejected.length > 0) {
          logger.error("ALERT: refusing to sign a checkpoint, some rows were not written by the application", {
            organisationId,
            rejectedCount: rejected.length,
            rejectedChainIds: rejected.slice(0, 20).map((r) => r.id),
          });
          continue;
        }
      }

      const payload = buildCheckpointPayload(rows, options.privateKeyPem);

      await prisma.$transaction(async (tx) => {
        const checkpoint = await tx.ledgerCheckpoint.create({
          data: {
            organisationId,
            merkleRoot: payload.merkleRoot,
            signature: payload.signature,
            rangeStart: payload.rangeStart,
            rangeEnd: payload.rangeEnd,
            recordCount: payload.recordsProcessed,
          },
        });

        await tx.ledgerChain.updateMany({
          where: { id: { in: payload.includedChainIds } },
          data: { checkpointId: checkpoint.id },
        });

        return checkpoint;
      });

      logger.info("Checkpoint cycle completed for organisation", {
        organisationId,
        reason: decision.reason,
        recordsProcessed: payload.recordsProcessed,
        merkleRoot: payload.merkleRoot,
        rangeStart: payload.rangeStart.toISOString(),
        rangeEnd: payload.rangeEnd.toISOString(),
      });
    } catch (err) {
      logger.error("Checkpoint cycle failed for organisation", {
        organisationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
