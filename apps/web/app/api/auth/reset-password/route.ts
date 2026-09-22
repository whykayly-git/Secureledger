import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { hashResetToken } from "@/lib/passwordReset";
import { hashPassword } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/api";

const EXPIRED_MESSAGE = "This link has expired. Request a new one.";

async function findUsableToken(rawToken: string) {
  const tokenHash = hashResetToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;
  return record;
}

/** Validates a token without consuming it, so the reset form can gate submission up front. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) {
      return NextResponse.json({ valid: false, message: EXPIRED_MESSAGE });
    }
    const record = await findUsableToken(token);
    return NextResponse.json({ valid: !!record, message: record ? undefined : EXPIRED_MESSAGE });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const rate = checkRateLimit(`reset-password:${clientKeyFromRequest(request)}`, 10, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many requests. Try again shortly.", 429);
    }

    const body = await request.json();
    const { token, password } = body ?? {};
    if (!token || typeof token !== "string") {
      throw new ApiError("token is required", 400);
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      throw new ApiError("Password must be at least 8 characters", 400);
    }

    const record = await findUsableToken(token);
    if (!record) {
      throw new ApiError(EXPIRED_MESSAGE, 400);
    }

    const passwordHash = await hashPassword(password);

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    // This app has no session/refresh-token table to invalidate — sessions
    // are stateless JWTs read straight from the httpOnly cookie, so there
    // is nothing further to revoke here (an already-issued JWT simply
    // remains valid until it expires on its own, same as any other
    // password change in this app).

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
