import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { AUTH_COOKIE_NAME, signSessionToken, verifyPassword } from "@/lib/auth";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { ApiError, handleApiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const rate = checkRateLimit(`login:${clientKeyFromRequest(request)}`, 10, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many login attempts. Try again shortly.", 429);
    }

    const body = await request.json();
    const { email, password } = body ?? {};
    if (!email || !password) {
      throw new ApiError("email and password are required", 400);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organisation: true },
    });

    // Constant-shaped error regardless of which check fails, to avoid
    // leaking whether an email is registered.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError("Invalid email or password", 401);
    }

    // Checked only after the password itself verifies, so a deactivated
    // account's status is never revealed to someone who doesn't already
    // know the correct password.
    if (!user.isActive) {
      throw new ApiError("This account has been deactivated. Contact your administrator.", 403);
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = signSessionToken({
      userId: user.id,
      organisationId: user.organisationId,
      role: user.role,
      email: user.email,
      isOrgAdmin: user.isOrgAdmin,
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isOrgAdmin: user.isOrgAdmin },
      organisation: { id: user.organisation.id, name: user.organisation.name },
    });
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
