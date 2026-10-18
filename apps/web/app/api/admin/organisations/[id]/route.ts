import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { ApiError, handleApiError } from "@/lib/api";
import { logAdminAction } from "@/lib/void";

async function loadOrganisation(id: string) {
  const org = await prisma.organisation.findUnique({ where: { id } });
  if (!org) throw new ApiError("Organisation not found", 404);
  return org;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("name is required", 400);

    const org = await loadOrganisation(params.id);
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.organisation.update({ where: { id: org.id }, data: { name } });
      await logAdminAction(tx, {
        organisationId: org.id,
        userId: session.userId,
        action: "PLATFORM_RENAME_ORG",
        targetType: "ORGANISATION",
        targetId: org.id,
        metadata: { from: org.name, to: name },
      });
      return result;
    });

    return NextResponse.json({ organisation: { id: updated.id, name: updated.name } });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Hard delete, only for an organisation with no ledger-affecting records.
 * An org that has ever posted a journal entry or invoice is part of the
 * tamper-evident ledger's history and is never deletable, even here.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const org = await loadOrganisation(params.id);
    if (org.id === session.organisationId) {
      throw new ApiError("You cannot delete the organisation you are currently in.", 400);
    }

    const [journalEntries, invoices, chainEntries, ownAccountInOrg] = await Promise.all([
      prisma.journalEntry.count({ where: { organisationId: org.id } }),
      prisma.invoice.count({ where: { organisationId: org.id } }),
      prisma.ledgerChain.count({ where: { organisationId: org.id } }),
      prisma.user.count({ where: { organisationId: org.id, id: session.userId } }),
    ]);
    if (ownAccountInOrg > 0) {
      throw new ApiError("You cannot delete the organisation your own account belongs to.", 400);
    }
    if (journalEntries > 0 || invoices > 0 || chainEntries > 0) {
      throw new ApiError(
        `${org.name} has ledger history (${journalEntries} journal entries, ${invoices} invoices, ${chainEntries} chain entries) and cannot be permanently deleted.`,
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { user: { organisationId: org.id } } });
      await tx.adminActionLog.deleteMany({ where: { organisationId: org.id } });
      await tx.verificationRun.deleteMany({ where: { organisationId: org.id } });
      await tx.ledgerCheckpoint.deleteMany({ where: { organisationId: org.id } });
      await tx.account.deleteMany({ where: { organisationId: org.id } });
      await tx.user.deleteMany({ where: { organisationId: org.id } });
      await tx.organisation.delete({ where: { id: org.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
