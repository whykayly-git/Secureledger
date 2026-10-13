/** Most chain rows one "Verify all" run will check, so a single request cannot tie the server up indefinitely. */
export const MAX_VERIFY_ALL_RECORDS = 5000;

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
