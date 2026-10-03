import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";

const STAFF_ACTION_LABELS: Record<string, string> = {
  INVITE_STAFF: "added",
  UPDATE_STAFF_ROLE: "updated the role of",
  DEACTIVATE_STAFF: "deactivated",
  REACTIVATE_STAFF: "reactivated",
  REMOVE_STAFF: "permanently removed",
  PLATFORM_RESET_PASSWORD: "reset the password of",
};

function describeStaffAction(action: string, actorName: string, metadata: unknown): string {
  const meta = (metadata ?? {}) as { name?: string; to?: { role?: string; isOrgAdmin?: boolean } };
  const targetName = meta.name ?? "a staff member";
  const label = STAFF_ACTION_LABELS[action] ?? action.toLowerCase();
  if (action === "UPDATE_STAFF_ROLE" && meta.to) {
    const roleNote = meta.to.role ? ` to ${meta.to.role}` : "";
    const adminNote = meta.to.isOrgAdmin ? " (admin access granted)" : "";
    return `${actorName} ${label} ${targetName}${roleNote}${adminNote}`;
  }
  return `${actorName} ${label} ${targetName}`;
}

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const { searchParams } = new URL(request.url);
    const recordType = searchParams.get("recordType");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

    if (recordType === "STAFF") {
      const staffLogs = await prisma.adminActionLog.findMany({
        where: {
          organisationId: session.organisationId,
          targetType: "USER",
          ...(from || to
            ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { user: { select: { name: true } } },
      });

      const entries = staffLogs.map((log) => {
        const actorName = log.user?.name ?? "Deleted user";
        return {
          kind: "STAFF" as const,
          id: log.id,
          action: log.action,
          createdAt: log.createdAt,
          summary: describeStaffAction(log.action, actorName, log.metadata),
        };
      });

      return NextResponse.json({ entries });
    }

    const chainRows = await prisma.ledgerChain.findMany({
      where: {
        organisationId: session.organisationId,
        ...(recordType ? { recordType: recordType as any } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const journalIds = chainRows.filter((r) => r.recordType === "JOURNAL_ENTRY").map((r) => r.recordId);
    const invoiceIds = chainRows.filter((r) => r.recordType === "INVOICE").map((r) => r.recordId);

    const [journalEntries, invoices] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { id: { in: journalIds } },
        select: {
          id: true,
          description: true,
          status: true,
          reversalOfEntryId: true,
          voidReason: true,
          createdBy: { select: { name: true } },
        },
      }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, customerName: true, status: true, relatedJournalEntryId: true, voidReason: true },
      }),
    ]);
    const journalById = new Map(journalEntries.map((j) => [j.id, j]));
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));

    const entries = chainRows.map((row) => {
      const journal = row.recordType === "JOURNAL_ENTRY" ? journalById.get(row.recordId) : undefined;
      const invoice = row.recordType === "INVOICE" ? invoiceById.get(row.recordId) : undefined;
      return {
        kind: "LEDGER" as const,
        chainId: row.id,
        recordType: row.recordType,
        recordId: row.recordId,
        hash: row.hash,
        previousHash: row.previousHash,
        checkpointed: !!row.checkpointId,
        createdAt: row.createdAt,
        summary: journal
          ? `${journal.description} (${journal.status}) — ${journal.createdBy?.name ?? "unknown"}`
          : invoice
            ? `Invoice for ${invoice.customerName} (${invoice.status})`
            : "Record deleted",
        reversalOfEntryId: journal?.reversalOfEntryId ?? null,
        voidReason: journal?.voidReason ?? invoice?.voidReason ?? null,
        relatedJournalEntryId: invoice?.relatedJournalEntryId ?? null,
      };
    });

    return NextResponse.json({ entries });
  } catch (err) {
    return handleApiError(err);
  }
}
