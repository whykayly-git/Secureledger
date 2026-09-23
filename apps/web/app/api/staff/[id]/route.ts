import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession, requireOrgAdmin } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
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

/**
 * Number of OTHER active admins in the organisation, i.e. excluding
 * `excludingUserId`. An inactive (deactivated) admin can't actually act as
 * one, so they don't count toward "the organisation still has a working
 * admin" — only active admins do.
 *
 * Takes a Prisma client/transaction client so the count can be read
 * inside the SAME transaction as the write that depends on it, right
 * before that write — narrowing (not eliminating, without a DB-level
 * constraint) the race window between two concurrent requests each
 * independently demoting/deactivating a different admin.
 */
async function otherActiveAdminCount(
  client: Pick<typeof prisma, "user">,
  organisationId: string,
  excludingUserId: string
): Promise<number> {
  return client.user.count({
    where: { organisationId, isOrgAdmin: true, isActive: true, id: { not: excludingUserId } },
  });
}

async function loadTarget(organisationId: string, id: string) {
  const target = await prisma.user.findFirst({ where: { id, organisationId } });
  if (!target) throw new ApiError("Staff member not found", 404);
  return target;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requireOrgAdmin(session);

    const body = await request.json();
    const { action } = body ?? {};
    const target = await loadTarget(session.organisationId, params.id);

    if (action === "updateRole") {
      const { role, isOrgAdmin } = body ?? {};
      if (role !== undefined && !VALID_ROLES.includes(role)) {
        throw new ApiError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
      }
      if (isOrgAdmin !== undefined && typeof isOrgAdmin !== "boolean") {
        throw new ApiError("isOrgAdmin must be a boolean", 400);
      }

      const removingAdminFlag = isOrgAdmin === false && target.isOrgAdmin === true;

      const updated = await prisma.$transaction(async (tx) => {
        if (removingAdminFlag) {
          const remaining = await otherActiveAdminCount(tx, session.organisationId, target.id);
          if (remaining === 0) {
            throw new ApiError(
              `${target.name} is the organisation's only remaining admin — assign another admin before removing this one.`,
              409
            );
          }
        }

        const result = await tx.user.update({
          where: { id: target.id },
          data: {
            ...(role !== undefined ? { role } : {}),
            ...(isOrgAdmin !== undefined ? { isOrgAdmin } : {}),
          },
          select: SAFE_USER_SELECT,
        });
        await logAdminAction(tx, {
          organisationId: session.organisationId,
          userId: session.userId,
          action: "UPDATE_STAFF_ROLE",
          targetType: "USER",
          targetId: target.id,
          metadata: {
            name: target.name,
            from: { role: target.role, isOrgAdmin: target.isOrgAdmin },
            to: { role: result.role, isOrgAdmin: result.isOrgAdmin },
          },
        });
        return result;
      });

      return NextResponse.json({ user: updated });
    }

    if (action === "deactivate") {
      if (target.id === session.userId) {
        throw new ApiError("You cannot deactivate your own account.", 400);
      }
      const updated = await prisma.$transaction(async (tx) => {
        if (target.isOrgAdmin && target.isActive) {
          const remaining = await otherActiveAdminCount(tx, session.organisationId, target.id);
          if (remaining === 0) {
            throw new ApiError(
              `${target.name} is the organisation's only remaining active admin — assign another admin before deactivating this one.`,
              409
            );
          }
        }

        const result = await tx.user.update({
          where: { id: target.id },
          data: { isActive: false },
          select: SAFE_USER_SELECT,
        });
        await logAdminAction(tx, {
          organisationId: session.organisationId,
          userId: session.userId,
          action: "DEACTIVATE_STAFF",
          targetType: "USER",
          targetId: target.id,
          metadata: { name: target.name, email: target.email },
        });
        return result;
      });

      return NextResponse.json({ user: updated });
    }

    if (action === "reactivate") {
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id: target.id },
          data: { isActive: true },
          select: SAFE_USER_SELECT,
        });
        await logAdminAction(tx, {
          organisationId: session.organisationId,
          userId: session.userId,
          action: "REACTIVATE_STAFF",
          targetType: "USER",
          targetId: target.id,
          metadata: { name: target.name, email: target.email },
        });
        return result;
      });

      return NextResponse.json({ user: updated });
    }

    throw new ApiError("action must be one of: updateRole, deactivate, reactivate", 400);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Hard delete — only permitted when the staff member has zero
 * ledger-affecting history (no JournalEntry or Invoice references them as
 * creator/voider). LedgerChain rows carry no direct user reference of
 * their own (they point at a JournalEntry/Invoice, which points at a
 * user), so checking JournalEntry/Invoice is sufficient to guarantee no
 * LedgerChain row is orphaned of its audit-trail meaning by this removal.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requireOrgAdmin(session);

    const target = await loadTarget(session.organisationId, params.id);

    if (target.id === session.userId) {
      throw new ApiError("You cannot remove your own account.", 400);
    }

    const [journalEntryCount, invoiceCount] = await Promise.all([
      prisma.journalEntry.count({
        where: { organisationId: session.organisationId, OR: [{ createdById: target.id }, { voidedByUserId: target.id }] },
      }),
      prisma.invoice.count({ where: { organisationId: session.organisationId, voidedByUserId: target.id } }),
    ]);

    if (journalEntryCount > 0 || invoiceCount > 0) {
      throw new ApiError(
        `${target.name} has ledger-affecting history (${journalEntryCount} journal entry action(s), ${invoiceCount} invoice action(s)) and cannot be permanently removed — deactivate them instead to preserve audit-trail integrity.`,
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      await logAdminAction(tx, {
        organisationId: session.organisationId,
        userId: session.userId,
        action: "REMOVE_STAFF",
        targetType: "USER",
        targetId: target.id,
        metadata: { name: target.name, email: target.email },
      });
      await tx.user.delete({ where: { id: target.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
