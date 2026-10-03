import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { AUTH_COOKIE_NAME, signSessionToken } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { ApiError, handleApiError } from "@/lib/api";

/** Leaves "Open as admin" mode: re-issues the session from the admin's own account record. */
export async function POST() {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new ApiError("Account not found", 404);

    const token = signSessionToken({
      userId: user.id,
      organisationId: user.organisationId,
      role: user.role,
      email: user.email,
      isOrgAdmin: user.isOrgAdmin,
    });

    const response = NextResponse.json({ ok: true });
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
