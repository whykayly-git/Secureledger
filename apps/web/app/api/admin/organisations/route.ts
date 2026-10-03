import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const organisations = await prisma.organisation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { users: true, accounts: true, journalEntries: true, invoices: true, ledgerChain: true } },
      },
    });

    return NextResponse.json({
      organisations: organisations.map((o) => ({
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        counts: {
          users: o._count.users,
          accounts: o._count.accounts,
          journalEntries: o._count.journalEntries,
          invoices: o._count.invoices,
          chainEntries: o._count.ledgerChain,
        },
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
