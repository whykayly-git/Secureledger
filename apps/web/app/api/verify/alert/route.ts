import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { getAlertState } from "@secureledger/verification";

/**
 * Whether the organisation has an unacknowledged verification problem. Open
 * to auditors, who can act on it, and to organisation administrators, who
 * are told so they can ask an auditor to review. Only counts are returned.
 */
export async function GET() {
  try {
    const session = requireSession();
    if (session.role !== "AUDITOR" && !session.isOrgAdmin) {
      throw new ForbiddenError("Requires auditor role or organisation admin access");
    }

    const { active, latest } = await getAlertState(session.organisationId);
    return NextResponse.json({
      active,
      run:
        active && latest
          ? {
              id: latest.id,
              source: latest.source,
              createdAt: latest.createdAt,
              failed: latest.failedCount,
              gaps: latest.gapCount,
            }
          : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
