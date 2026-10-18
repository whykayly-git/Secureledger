import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireRole, requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";

/** Auditor-only: the organisation's recent verification runs, scheduled and manual, newest first. */
export async function GET(request: Request) {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 100);

    const runs = await prisma.verificationRun.findMany({
      where: { organisationId: session.organisationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        source: r.source,
        createdAt: r.createdAt,
        durationMs: r.durationMs,
        totalRecords: r.totalRecords,
        checkedRecords: r.checkedRecords,
        verified: r.verifiedCount,
        pending: r.pendingCount,
        failed: r.failedCount,
        continuityIntact: r.continuityIntact,
        gapCount: r.gapCount,
        hasProblems: r.problemSignature !== null,
        acknowledged: r.acknowledgedAt !== null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
