import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { AUTH_COOKIE_NAME, signSessionToken } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { ApiError, handleApiError } from "@/lib/api";
import { logAdminAction } from "@/lib/void";

/**
 * "Open as admin": re-issues the platform admin's own session scoped to the
 * target organisation with the highest in-app privileges (AUDITOR +
 * org admin), so every existing page works there with full access. The
 * session keeps the admin's own userId, so anything they post is attributed
 * to them honestly, and entering is recorded in that org's audit trail.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const org = await prisma.organisation.findUnique({ where: { id: params.id } });
    if (!org) throw new ApiError("Organisation not found", 404);

    await prisma.$transaction((tx) =>
      logAdminAction(tx, {
        organisationId: org.id,
        userId: session.userId,
        action: "PLATFORM_ENTER_ORG",
        targetType: "ORGANISATION",
        targetId: org.id,
        metadata: { name: org.name },
      })
    );

    const token = signSessionToken({
      userId: session.userId,
      organisationId: org.id,
      role: "AUDITOR",
      email: session.email,
      isOrgAdmin: true,
      actingAsPlatformAdmin: true,
    });

    const response = NextResponse.json({ organisation: { id: org.id, name: org.name } });
    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
