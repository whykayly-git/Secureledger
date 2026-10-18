import type { PrismaClient } from "@secureledger/db";
import {
  MAX_VERIFY_ALL_RECORDS,
  OrganisationVerification,
  recordVerificationRun,
  verifyOrganisation,
} from "@secureledger/verification";
import { logger } from "./logger";

export type VerificationCycleOptions = {
  /** How long after an organisation's last scheduled run the next one is due. 0 or less turns scheduling off. */
  intervalMs: number;
  maxRecords?: number;
  now?: Date;
  /** Injection points so the schedule logic can be tested without a verifier or a database of records. */
  verify?: (organisationId: string, maxRecords: number) => Promise<OrganisationVerification>;
  record?: (organisationId: string, v: OrganisationVerification) => Promise<unknown>;
};

/** Clean runs older than this are deleted. Runs that found problems are kept as part of the audit trail. */
const CLEAN_RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

/**
 * Runs a full verification for every organisation whose last SCHEDULED run is
 * older than the interval (or that has never had one), stores the result, and
 * logs loudly when it finds a problem. An organisation with no chain rows and
 * no checkpoints has nothing to protect and is skipped. A failure for one
 * organisation is logged and does not stop the others.
 *
 * Returns the number of organisations verified in this cycle.
 */
export async function runVerificationCycle(prisma: PrismaClient, options: VerificationCycleOptions): Promise<number> {
  if (options.intervalMs <= 0) return 0;

  const now = options.now ?? new Date();
  const maxRecords = options.maxRecords ?? MAX_VERIFY_ALL_RECORDS;
  const verify = options.verify ?? verifyOrganisation;
  const record =
    options.record ?? ((organisationId: string, v: OrganisationVerification) => recordVerificationRun(organisationId, "SCHEDULED", v));

  const organisations = await prisma.organisation.findMany({ select: { id: true } });
  let verified = 0;

  for (const { id: organisationId } of organisations) {
    try {
      const lastRun = await prisma.verificationRun.findFirst({
        where: { organisationId, source: "SCHEDULED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastRun && now.getTime() - lastRun.createdAt.getTime() < options.intervalMs) continue;

      const [chainRows, checkpoints] = await Promise.all([
        prisma.ledgerChain.count({ where: { organisationId } }),
        prisma.ledgerCheckpoint.count({ where: { organisationId } }),
      ]);
      if (chainRows === 0 && checkpoints === 0) continue;

      const result = await verify(organisationId, maxRecords);
      await record(organisationId, result);
      verified += 1;

      const summary = {
        organisationId,
        checked: result.checkedRecords,
        verified: result.counts.verified,
        pending: result.counts.pending,
        failed: result.counts.failed,
        chainGaps: result.continuity.gaps.length,
        durationMs: result.durationMs,
      };
      if (result.counts.failed > 0 || !result.continuity.intact) {
        logger.error("ALERT: scheduled verification found problems", summary);
      } else {
        logger.info("Scheduled verification completed with no problems", summary);
      }
    } catch (err) {
      logger.error("Scheduled verification failed for organisation", {
        organisationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (now.getTime() - lastPruneAt >= PRUNE_EVERY_MS) {
    lastPruneAt = now.getTime();
    try {
      await prisma.verificationRun.deleteMany({
        where: { problemSignature: null, createdAt: { lt: new Date(now.getTime() - CLEAN_RUN_RETENTION_MS) } },
      });
    } catch (err) {
      logger.error("Pruning old verification runs failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return verified;
}
