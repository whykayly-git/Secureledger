import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { generateRawToken, hashResetToken, RESET_TOKEN_TTL_MS } from "@/lib/passwordReset";
import { normalizeEmail } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/api";

const GENERIC_MESSAGE = "If an account exists for that email, a password reset link has been generated.";

/**
 * Never reveals whether the email is registered: a real, persisted,
 * usable token is only created when a user actually matches, but a
 * same-shaped decoy link is returned either way, so the response itself
 * carries no signal. (A submitted token that doesn't exist in the DB and
 * an expired/used one both fail identically at /reset-password — that's
 * true of any token-based reset design, not a new leak introduced here.)
 *
 * No email-sending infrastructure exists in this app yet, so the link is
 * returned directly for the UI to show in a "copy this link" panel — the
 * token storage (hash, not plaintext, single-use, short expiry) is
 * structured so a real email-send step could replace this response field
 * later without changing the data model.
 */
export async function POST(request: Request) {
  try {
    const rate = checkRateLimit(`forgot-password:${clientKeyFromRequest(request)}`, 5, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many requests. Try again shortly.", 429);
    }

    const body = await request.json();
    const { email } = body ?? {};
    if (!email || typeof email !== "string") {
      throw new ApiError("email is required", 400);
    }

    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

    let token = generateRawToken();
    if (user) {
      const tokenHash = hashResetToken(token);
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
    }
    // else: `token` is generated but never persisted — a structurally
    // identical, unusable decoy so this response never differs by
    // whether the email matched.

    return NextResponse.json({
      message: GENERIC_MESSAGE,
      resetPath: `/reset-password?token=${token}`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
