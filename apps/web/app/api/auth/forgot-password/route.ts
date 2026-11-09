import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { generateRawToken, hashResetToken, RESET_TOKEN_TTL_MS } from "@/lib/passwordReset";
import { normalizeEmail } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/api";
import { appBaseUrl, getMailConfig, passwordResetEmail, resetDelivery, sendMail } from "@/lib/mail";

const LINK_MESSAGE = "If an account exists for that email, a password reset link has been generated.";
const EMAIL_MESSAGE = "If an account exists for that email, we have sent a password reset link to it. It expires in 1 hour.";
const UNAVAILABLE_MESSAGE =
  "Password reset by email is not set up on this system. Contact the person who runs it to have your password reset.";

/**
 * How the reset link reaches the person depends on the environment (see resetDelivery):
 *
 *  - email:       the link is emailed to the account's address and is NEVER in the response.
 *  - link:        development only. The link is returned so it can be shown on screen.
 *  - unavailable: production without a working email setup. No token is created at all.
 *
 * Returning a working link to whoever asks, which this route used to do everywhere, would let
 * anyone who knows an email address take over that account, so that is now confined to
 * development. The response never reveals whether the address is registered: the same message
 * comes back either way, and in email mode the send is not awaited so the response time does
 * not depend on whether an account matched.
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

    const delivery = resetDelivery();
    if (delivery === "unavailable") {
      console.warn("Password reset requested, but email delivery is not configured (MAIL_*, APP_BASE_URL).");
      return NextResponse.json({ message: UNAVAILABLE_MESSAGE });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

    const token = generateRawToken();
    if (user) {
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashResetToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
    }
    // else: `token` is generated but never stored, so a decoy has the same shape as a real one.

    if (delivery === "email") {
      const config = getMailConfig();
      const base = appBaseUrl();
      if (user && config && base) {
        const { subject, text } = passwordResetEmail(user.name, `${base}/reset-password?token=${token}`);
        // Not awaited, so the response time does not reveal whether the account exists.
        sendMail(config, { to: user.email, subject, text }).catch((err) => {
          console.error("Password reset email failed", { userId: user.id, error: err instanceof Error ? err.message : String(err) });
        });
      }
      return NextResponse.json({ message: EMAIL_MESSAGE });
    }

    // Development only.
    return NextResponse.json({ message: LINK_MESSAGE, resetPath: `/reset-password?token=${token}` });
  } catch (err) {
    return handleApiError(err);
  }
}
