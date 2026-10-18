import { createHash } from "crypto";
import { prisma } from "@secureledger/db";
import { verifyLedgerChainEntryById } from "./verify";
import { verifyChainContinuity, ContinuityGap } from "./continuity";

/** Most chain rows one full verification will check, so a single run cannot tie a server up indefinitely. */
export const MAX_VERIFY_ALL_RECORDS = 5000;

/** How many failing records and chain gaps a stored run keeps in full. Counts are always exact. */
const MAX_STORED_FAILURES = 100;
const MAX_STORED_GAPS = 50;

export type VerifyAllFailure = {
  chainId: string;
  recordId: string;
  recordType: string;
  createdAt: string;
  failureReason: string;
};

type VerifyResultLike = {
  verdict: "verified" | "failed" | "pending";
  chainId: string;
  recordId: string;
  recordType: string;
  createdAt: Date;
  failureReason?: string | null;
};

export type VerifyAllSummary = {
  counts: { verified: number; pending: number; failed: number };
  failures: VerifyAllFailure[];
};

/**
 * Runs the real per-record verifier over each chain row, one at a time, and
 * tallies the verdicts. A row whose verification throws (for example a
 * checkpoint that has gone missing) is counted as failed, never skipped, so
 * a broken record cannot disappear from the report. A row that no longer
 * exists is ignored.
 */
export async function summariseVerification(
  chainIds: string[],
  verify: (chainId: string) => Promise<VerifyResultLike | null>
): Promise<VerifyAllSummary> {
  const counts = { verified: 0, pending: 0, failed: 0 };
  const failures: VerifyAllFailure[] = [];

  for (const chainId of chainIds) {
    let result: VerifyResultLike | null;
    try {
      result = await verify(chainId);
    } catch {
      counts.failed += 1;
      failures.push({ chainId, recordId: "", recordType: "", createdAt: "", failureReason: "verification_error" });
      continue;
    }
    if (!result) continue;

    if (result.verdict === "verified") counts.verified += 1;
    else if (result.verdict === "pending") counts.pending += 1;
    else {
      counts.failed += 1;
      failures.push({
        chainId: result.chainId,
        recordId: result.recordId,
        recordType: result.recordType,
        createdAt: result.createdAt.toISOString(),
        failureReason: result.failureReason ?? "unknown",
      });
    }
  }

  return { counts, failures };
}

export type OrganisationVerification = {
  totalRecords: number;
  checkedRecords: number;
  truncated: boolean;
  counts: { verified: number; pending: number; failed: number };
  failures: VerifyAllFailure[];
  continuity: { intact: boolean; totalRows: number; gaps: ContinuityGap[] };
  durationMs: number;
};

/**
 * Verifies an organisation's ledger: the per-record verifier over its newest
 * chain rows (up to maxRecords) and the organisation-wide continuity sweep,
 * which catches deleted rows that no per-record check can see.
 */
export async function verifyOrganisation(
  organisationId: string,
  maxRecords: number = MAX_VERIFY_ALL_RECORDS
): Promise<OrganisationVerification> {
  const started = Date.now();
  const [totalRecords, rows] = await Promise.all([
    prisma.ledgerChain.count({ where: { organisationId } }),
    prisma.ledgerChain.findMany({
      where: { organisationId },
      orderBy: { sequenceNumber: "desc" },
      take: maxRecords,
      select: { id: true },
    }),
  ]);

  const summary = await summariseVerification(
    rows.map((r) => r.id),
    (chainId) => verifyLedgerChainEntryById(chainId, organisationId)
  );
  const continuity = await verifyChainContinuity(organisationId);

  return {
    totalRecords,
    checkedRecords: rows.length,
    truncated: totalRecords > rows.length,
    counts: summary.counts,
    failures: summary.failures,
    continuity: { intact: continuity.intact, totalRows: continuity.totalRows, gaps: continuity.gaps },
    durationMs: Date.now() - started,
  };
}

/**
 * A fingerprint of exactly what a run found, or null when it found nothing.
 * Two runs that report the same failing records and the same chain gaps have
 * the same signature, which is what lets an auditor's acknowledgement carry
 * over to later runs that find nothing new.
 */
export function problemSignature(v: Pick<OrganisationVerification, "failures" | "continuity">): string | null {
  const parts = [
    ...v.failures.map((f) => `F:${f.chainId}:${f.failureReason}`),
    ...v.continuity.gaps.map((g) => `G:${g.type}:${g.chainId ?? g.checkpointId ?? ""}`),
  ].sort();
  if (parts.length === 0) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export type RunSource = "SCHEDULED" | "MANUAL";

/** Stores a finished verification so it appears in the run history and can raise an alert. */
export async function recordVerificationRun(organisationId: string, source: RunSource, v: OrganisationVerification) {
  return prisma.verificationRun.create({
    data: {
      organisationId,
      source,
      durationMs: v.durationMs,
      totalRecords: v.totalRecords,
      checkedRecords: v.checkedRecords,
      verifiedCount: v.counts.verified,
      pendingCount: v.counts.pending,
      failedCount: v.counts.failed,
      continuityIntact: v.continuity.intact,
      gapCount: v.continuity.gaps.length,
      problemSignature: problemSignature(v),
      details: {
        truncated: v.truncated,
        failures: v.failures.slice(0, MAX_STORED_FAILURES),
        gaps: v.continuity.gaps.slice(0, MAX_STORED_GAPS).map((g) => ({ type: g.type, detail: g.detail })),
      },
    },
  });
}

/**
 * Whether the organisation currently has an unacknowledged verification
 * problem. The latest run decides: a clean latest run means no alert, and a
 * latest run with problems is an alert unless a run with the very same
 * findings has already been acknowledged.
 */
export async function getAlertState(organisationId: string) {
  const latest = await prisma.verificationRun.findFirst({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
  });
  if (!latest || !latest.problemSignature) return { active: false as const, latest };

  const acknowledged = await prisma.verificationRun.findFirst({
    where: { organisationId, problemSignature: latest.problemSignature, acknowledgedAt: { not: null } },
    select: { id: true },
  });
  return { active: !acknowledged, latest };
}

/** Marks the current findings as seen. Later runs that find the same thing stay quiet. */
export async function acknowledgeAlert(organisationId: string, userId: string) {
  const state = await getAlertState(organisationId);
  if (state.active && state.latest) {
    await prisma.verificationRun.update({
      where: { id: state.latest.id },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
    });
  }
  return getAlertState(organisationId);
}
