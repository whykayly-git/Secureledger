import type { PrismaClient } from "@secureledger/db";
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
        select: { id: true, hash: true, createdAt: true },
      });

      const payload = buildCheckpointPayload(rows, options.privateKeyPem);

      await prisma.$transaction(async (tx) => {
        const checkpoint = await tx.ledgerCheckpoint.create({
          data: {
            organisationId,
            merkleRoot: payload.merkleRoot,
            signature: payload.signature,
            rangeStart: payload.rangeStart,
            rangeEnd: payload.rangeEnd,
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
