import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { handleApiError } from "@/lib/api";

/** Platform-wide feed of administrative actions across every organisation. */
export async function GET(request: Request) {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

    const logs = await prisma.adminActionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { organisation: { select: { name: true } }, user: { select: { name: true, email: true } } },
    });

    return NextResponse.json({
      entries: logs.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        organisation: l.organisation.name,
        actor: l.user ? `${l.user.name} (${l.user.email})` : "Deleted user",
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        metadata: l.metadata,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
