import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const body = await request.json();
    const { name, type, code } = body ?? {};

    const existing = await prisma.account.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!existing) {
      throw new ApiError("Account not found", 404);
    }

    const account = await prisma.account.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(code !== undefined ? { code } : {}),
      },
    });

    return NextResponse.json({ account });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const existing = await prisma.account.findFirst({
      where: { id: params.id, organisationId: session.organisationId },
    });
    if (!existing) {
      throw new ApiError("Account not found", 404);
    }

    const usageCount = await prisma.journalLine.count({ where: { accountId: params.id } });
    if (usageCount > 0) {
      throw new ApiError("Cannot delete an account that has journal lines posted against it", 409);
    }

    await prisma.account.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
