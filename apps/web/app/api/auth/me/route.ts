import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { isPlatformAdminEmail } from "@/lib/platformAdmin";

export async function GET() {
  try {
    const session = requireSession();
    const [user, organisation] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.userId } }),
      prisma.organisation.findUnique({ where: { id: session.organisationId } }),
    ]);
    if (!user || !organisation) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const acting = session.actingAsPlatformAdmin === true && isPlatformAdminEmail(user.email);
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        // While a platform admin is acting inside another organisation, the
        // session's elevated claims apply, not the user's home-org record.
        role: acting ? session.role : user.role,
        isOrgAdmin: acting ? session.isOrgAdmin : user.isOrgAdmin,
        isPlatformAdmin: isPlatformAdminEmail(user.email),
      },
      organisation: { id: organisation.id, name: organisation.name },
      actingAsPlatformAdmin: acting,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
