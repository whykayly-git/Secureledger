import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { AUTH_COOKIE_NAME, hashPassword, signSessionToken } from "@/lib/auth";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { ApiError, handleApiError } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const rate = checkRateLimit(`register:${clientKeyFromRequest(request)}`, 10, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many registration attempts. Try again shortly.", 429);
    }

    const body = await request.json();
    const { organisationName, name, email, password } = body ?? {};

    if (!organisationName || !name || !email || !password) {
      throw new ApiError("organisationName, name, email and password are required", 400);
    }
    if (typeof password !== "string" || password.length < 8) {
      throw new ApiError("Password must be at least 8 characters", 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError("An account with this email already exists", 409);
    }

    const passwordHash = await hashPassword(password);

    const { user, organisation } = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({ data: { name: organisationName } });
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: "ACCOUNTANT",
          organisationId: organisation.id,
          // /register always creates a brand new organisation together
          // with this user, so they are unconditionally its first (and
          // only, at this point) member — always the org admin.
          isOrgAdmin: true,
        },
      });
      return { user, organisation };
    });

    const token = signSessionToken({
      userId: user.id,
      organisationId: organisation.id,
      role: user.role,
      email: user.email,
      isOrgAdmin: user.isOrgAdmin,
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isOrgAdmin: user.isOrgAdmin },
      organisation: { id: organisation.id, name: organisation.name },
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
