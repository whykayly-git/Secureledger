import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { validateBalancedLines } from "@/lib/validation";
import { appendLedgerChainEntry, journalEntryHashFields, timed } from "@secureledger/ledger";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const entries = await prisma.journalEntry.findMany({
      where: {
        organisationId: session.organisationId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        lines: { include: { account: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: limit,
    });

    const recordIds = entries.map((e) => e.id);
    const chainRows = await prisma.ledgerChain.findMany({
      where: { recordId: { in: recordIds }, recordType: "JOURNAL_ENTRY" },
      select: { recordId: true, hash: true, checkpointId: true },
    });
    const chainByRecordId = new Map(chainRows.map((c) => [c.recordId, c]));

    const result = entries.map((entry) => ({
      ...entry,
      chain: chainByRecordId.get(entry.id) ?? null,
    }));

    return NextResponse.json({ journalEntries: result });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const { date, description, lines } = body ?? {};

    if (!date || !description) {
      throw new ApiError("date and description are required", 400);
    }
    validateBalancedLines(lines);

    const accountIds: string[] = [...new Set<string>(lines.map((l: any) => l.accountId as string))];
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds }, organisationId: session.organisationId },
    });
    if (accounts.length !== accountIds.length) {
      throw new ApiError("One or more accounts are invalid for this organisation", 400);
    }

    // Benchmark instrumentation only — wraps the real appendLedgerChainEntry
    // call to isolate hash-chaining latency from the rest of the request,
    // without changing what it does. Exposed as a response header so
    // /scripts/benchmark.ts can report it separately from total latency.
    let hashChainLatencyMs = 0;

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          organisationId: session.organisationId,
          date: new Date(date),
          description,
          status: "POSTED",
          createdById: session.userId,
          lines: {
            create: lines.map((l: any) => ({
              accountId: l.accountId,
              debit: Number(l.debit ?? 0),
              credit: Number(l.credit ?? 0),
              memo: l.memo ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      const fields = journalEntryHashFields(created);
      const { durationMs } = await timed(() =>
        appendLedgerChainEntry(tx, {
          organisationId: session.organisationId,
          recordType: "JOURNAL_ENTRY",
          recordId: created.id,
          fields,
        })
      );
      hashChainLatencyMs = durationMs;

      return created;
    });

    return NextResponse.json(
      { journalEntry: entry },
      { status: 201, headers: { "X-Hash-Chain-Latency-Ms": hashChainLatencyMs.toFixed(3) } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
