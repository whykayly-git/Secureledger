import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireRole, requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { MAX_VERIFY_ALL_RECORDS, summariseVerification } from "@/lib/verifyAll";
import { verifyChainContinuity, verifyLedgerChainEntryById } from "@secureledger/verification";

/**
 * Auditor-only: verifies the organisation's chain in one request. Runs the
 * per-record verifier over the newest records (up to a cap) and the
 * organisation-wide continuity sweep, which catches deleted rows that no
 * per-record check can see.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const rate = checkRateLimit(`verify-all:${clientKeyFromRequest(request)}`, 3, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many full verification runs. Try again shortly.", 429);
    }

    const organisationId = session.organisationId;
    const started = Date.now();

    const [totalRecords, rows] = await Promise.all([
      prisma.ledgerChain.count({ where: { organisationId } }),
      prisma.ledgerChain.findMany({
        where: { organisationId },
        orderBy: { sequenceNumber: "desc" },
        take: MAX_VERIFY_ALL_RECORDS,
        select: { id: true },
      }),
    ]);

    const summary = await summariseVerification(
      rows.map((r) => r.id),
      (chainId) => verifyLedgerChainEntryById(chainId, organisationId)
    );
    const continuity = await verifyChainContinuity(organisationId);

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      totalRecords,
      checkedRecords: rows.length,
      truncated: totalRecords > rows.length,
      counts: summary.counts,
      failures: summary.failures,
      continuity: { intact: continuity.intact, totalRows: continuity.totalRows, gaps: continuity.gaps },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
