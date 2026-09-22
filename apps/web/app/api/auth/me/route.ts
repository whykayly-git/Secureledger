import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { organisation: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organisation: { id: user.organisation.id, name: user.organisation.name },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
