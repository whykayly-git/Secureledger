import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession, requireRole } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { createReversingEntry, logAdminAction } from "@/lib/void";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const entry = await prisma.journalEntry.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
      include: { lines: { include: { account: true } }, createdBy: { select: { name: true } } },
    });
    if (!entry) throw new ApiError("Journal entry not found", 404);
    return NextResponse.json({ journalEntry: entry });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Void a posted entry (requires a reason; posts a reversing entry through the real write path). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    requireRole(session, "ACCOUNTANT", "AUDITOR");

    const body = await request.json();
    const { action, reason } = body ?? {};

    if (action !== "void") {
      throw new ApiError("action must be 'void'", 400);
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw new ApiError("A reason is required to void a journal entry", 400);
    }

    const entry = await prisma.journalEntry.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
      include: { lines: true },
    });
    if (!entry) throw new ApiError("Journal entry not found", 404);
    if (entry.status !== "POSTED") {
      throw new ApiError("Only posted entries can be voided", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const reversingEntry = await createReversingEntry(tx, {
        organisationId: session.organisationId,
        originalEntry: entry,
        description: `Reversal of "${entry.description}": ${reason.trim()}`,
        createdById: session.userId,
      });

      const voided = await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          status: "VOID",
          voidedByUserId: session.userId,
          voidedAt: new Date(),
          voidReason: reason.trim(),
        },
      });

      return { voided, reversingEntry };
    });

    return NextResponse.json({
      journalEntry: result.voided,
      reversingEntry: result.reversingEntry,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Delete a draft entry (never posted, never hash-chained) — logged to the admin action trail, not the ledger. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();

    const entry = await prisma.journalEntry.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!entry) throw new ApiError("Journal entry not found", 404);
    if (entry.status !== "DRAFT") {
      throw new ApiError("Only draft entries can be deleted — posted entries must be voided instead", 409);
    }

    const isCreator = entry.createdById === session.userId;
    const isPrivileged = session.role === "ACCOUNTANT" || session.role === "AUDITOR";
    if (!isCreator && !isPrivileged) {
      throw new ApiError("Only the entry's creator or an accountant/auditor can delete it", 403);
    }

    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await logAdminAction(tx, {
        organisationId: session.organisationId,
        userId: session.userId,
        action: "DELETE_DRAFT_JOURNAL_ENTRY",
        targetType: "JOURNAL_ENTRY",
        targetId: entry.id,
        metadata: { description: entry.description },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
