import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { verifyChainContinuity } from "@secureledger/verification";

/**
 * Auditor-only: organisation-wide chain-continuity sweep, distinct from
 * the per-record verdict /api/verify/[recordId] returns. Catches what no
 * per-record check can — a cleanly DELETED LedgerChain row, which leaves
 * every surviving row's own hash and previousHash internally consistent.
 * See packages/verification/src/continuity.ts for the two checks this
 * runs (sequence contiguity, checkpoint count/range) and the one honest
 * gap neither closes (an uncheckpointed tip row deleted before it was
 * ever committed to a checkpoint).
 */
export async function GET() {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const result = await verifyChainContinuity(session.organisationId);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
