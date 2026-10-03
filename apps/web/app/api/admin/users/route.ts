import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOrgAdmin: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        organisation: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ users });
  } catch (err) {
    return handleApiError(err);
  }
}
