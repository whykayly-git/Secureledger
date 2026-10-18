import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { recordVerificationRun, verifyOrganisation } from "@secureledger/verification";

/**
 * Auditor-only: verifies the organisation's chain in one request. Runs the
 * per-record verifier over the newest records (up to a cap) and the
 * organisation-wide continuity sweep, which catches deleted rows that no
 * per-record check can see. The result is stored as a MANUAL run, so it
 * appears in the run history and can raise the verification alert.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const rate = checkRateLimit(`verify-all:${clientKeyFromRequest(request)}`, 3, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many full verification runs. Try again shortly.", 429);
    }

    const result = await verifyOrganisation(session.organisationId);
    const run = await recordVerificationRun(session.organisationId, "MANUAL", result);

    return NextResponse.json({
      runId: run.id,
      checkedAt: run.createdAt.toISOString(),
      durationMs: result.durationMs,
      totalRecords: result.totalRecords,
      checkedRecords: result.checkedRecords,
      truncated: result.truncated,
      counts: result.counts,
      failures: result.failures,
      continuity: result.continuity,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
