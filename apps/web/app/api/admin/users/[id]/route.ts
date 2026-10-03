import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { hashPassword } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { ApiError, handleApiError } from "@/lib/api";
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

async function loadTarget(id: string) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new ApiError("User not found", 404);
  return target;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const body = await request.json();
    const { action } = body ?? {};
    const target = await loadTarget(params.id);
    const isSelf = target.id === session.userId;
    const log = (tx: Parameters<typeof logAdminAction>[0], name: string, metadata: Record<string, unknown>) =>
      logAdminAction(tx, {
        organisationId: target.organisationId,
        userId: session.userId,
        action: name,
        targetType: "USER",
        targetId: target.id,
        metadata: { name: target.name, email: target.email, byPlatformAdmin: true, ...metadata },
      });

    if (action === "updateRole") {
      const { role, isOrgAdmin } = body ?? {};
      if (role !== undefined && !VALID_ROLES.includes(role)) {
        throw new ApiError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
      }
      if (isOrgAdmin !== undefined && typeof isOrgAdmin !== "boolean") {
        throw new ApiError("isOrgAdmin must be a boolean", 400);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id: target.id },
          data: {
            ...(role !== undefined ? { role } : {}),
            ...(isOrgAdmin !== undefined ? { isOrgAdmin } : {}),
          },
          select: SAFE_USER_SELECT,
        });
        await log(tx, "UPDATE_STAFF_ROLE", {
          from: { role: target.role, isOrgAdmin: target.isOrgAdmin },
          to: { role: result.role, isOrgAdmin: result.isOrgAdmin },
        });
        return result;
      });
      return NextResponse.json({ user: updated });
    }

    if (action === "deactivate") {
      if (isSelf) throw new ApiError("You cannot deactivate your own account.", 400);
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({ where: { id: target.id }, data: { isActive: false }, select: SAFE_USER_SELECT });
        await log(tx, "DEACTIVATE_STAFF", {});
        return result;
      });
      return NextResponse.json({ user: updated });
    }

    if (action === "reactivate") {
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({ where: { id: target.id }, data: { isActive: true }, select: SAFE_USER_SELECT });
        await log(tx, "REACTIVATE_STAFF", {});
        return result;
      });
      return NextResponse.json({ user: updated });
    }

    if (action === "resetPassword") {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
        await log(tx, "PLATFORM_RESET_PASSWORD", {});
      });
      return NextResponse.json({ temporaryPassword });
    }

    throw new ApiError("action must be one of: updateRole, deactivate, reactivate, resetPassword", 400);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Hard delete only when the user has no ledger-affecting history, mirroring Manage Staff's Remove. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const target = await loadTarget(params.id);
    if (target.id === session.userId) throw new ApiError("You cannot remove your own account.", 400);

    const [journalEntries, invoices] = await Promise.all([
      prisma.journalEntry.count({ where: { OR: [{ createdById: target.id }, { voidedByUserId: target.id }] } }),
      prisma.invoice.count({ where: { voidedByUserId: target.id } }),
    ]);
    if (journalEntries > 0 || invoices > 0) {
      throw new ApiError(
        `${target.name} has ledger-affecting history (${journalEntries} journal entry action(s), ${invoices} invoice action(s)) and cannot be permanently removed — deactivate them instead.`,
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      await logAdminAction(tx, {
        organisationId: target.organisationId,
        userId: session.userId,
        action: "REMOVE_STAFF",
        targetType: "USER",
        targetId: target.id,
        metadata: { name: target.name, email: target.email, byPlatformAdmin: true },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId: target.id } });
      await tx.user.delete({ where: { id: target.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
