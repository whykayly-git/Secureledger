import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { acknowledgeAlert } from "@secureledger/verification";

/** Auditor-only: marks the current findings as seen. A later run that finds something new alerts again. */
export async function POST() {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const state = await acknowledgeAlert(session.organisationId, session.userId);
    return NextResponse.json({ active: state.active });
  } catch (err) {
    return handleApiError(err);
  }
}
