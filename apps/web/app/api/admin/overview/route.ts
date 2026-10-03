import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { requirePlatformAdmin } from "@/lib/platformAdmin";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();
    requirePlatformAdmin(session);

    const [organisations, users, activeUsers, journalEntries, invoices, chainEntries, pendingChain, checkpoints] =
      await Promise.all([
        prisma.organisation.count(),
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.journalEntry.count(),
        prisma.invoice.count(),
        prisma.ledgerChain.count(),
        prisma.ledgerChain.count({ where: { checkpointId: null } }),
        prisma.ledgerCheckpoint.count(),
      ]);

    return NextResponse.json({
      organisations,
      users,
      activeUsers,
      journalEntries,
      invoices,
      chainEntries,
      pendingChain,
      checkpoints,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
