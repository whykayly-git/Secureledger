import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession, requireOrgAdmin } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { hashPassword, normalizeEmail } from "@/lib/auth";
import { generateTemporaryPassword } from "@/lib/tempPassword";
import { logAdminAction } from "@/lib/void";

const VALID_ROLES = ["BOOKKEEPER", "ACCOUNTANT", "AUDITOR"] as const;

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isOrgAdmin: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

/** List every staff member in the caller's organisation. Org-admin only. */
export async function GET() {
  try {
    const session = requireSession();
    requireOrgAdmin(session);

    const staff = await prisma.user.findMany({
      where: { organisationId: session.organisationId },
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ staff });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Invite/add a new staff member. No email infrastructure exists in this
 * app (same as the password-reset flow), so a one-time temporary password
 * is generated here and returned directly in this response, never
 * persisted in plaintext, for the UI to show exactly once in a
 * "copy this and share it securely" panel.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    requireOrgAdmin(session);

    const body = await request.json();
    const { name, email, role, isOrgAdmin } = body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      throw new ApiError("name is required", 400);
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError("A valid email is required", 400);
    }
    if (!VALID_ROLES.includes(role)) {
      throw new ApiError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
    }
    if (isOrgAdmin !== undefined && typeof isOrgAdmin !== "boolean") {
      throw new ApiError("isOrgAdmin must be a boolean", 400);
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ApiError("An account with this email already exists", 409);
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organisationId: session.organisationId,
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role,
          isOrgAdmin: !!isOrgAdmin,
          isActive: true,
        },
        select: SAFE_USER_SELECT,
      });

      await logAdminAction(tx, {
        organisationId: session.organisationId,
        userId: session.userId,
        action: "INVITE_STAFF",
        targetType: "USER",
        targetId: created.id,
        metadata: { name: created.name, email: created.email, role: created.role, isOrgAdmin: created.isOrgAdmin },
      });

      return created;
    });

    return NextResponse.json({ user, temporaryPassword }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
