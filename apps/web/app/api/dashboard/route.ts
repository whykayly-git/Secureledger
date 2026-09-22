import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();
    const organisationId = session.organisationId;

    const accounts = await prisma.account.findMany({
      where: { organisationId },
      include: { journalLines: { where: { journalEntry: { status: "POSTED" } } } },
    });

    const sumByType = (type: string, sign: 1 | -1) =>
      accounts
        .filter((a) => a.type === type)
        .reduce(
          (total, a) =>
            total +
            sign * a.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
          0
        );

    const totalAssets = sumByType("ASSET", 1);
    const totalLiabilities = accounts
      .filter((a) => a.type === "LIABILITY")
      .reduce((total, a) => total + a.journalLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0), 0);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLines = await prisma.journalLine.findMany({
      where: {
        journalEntry: { organisationId, status: "POSTED", date: { gte: periodStart } },
      },
      include: { account: true },
    });
    const incomeThisPeriod = monthLines
      .filter((l) => l.account.type === "INCOME")
      .reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    const expenseThisPeriod = monthLines
      .filter((l) => l.account.type === "EXPENSE")
      .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

    const pendingChainCount = await prisma.ledgerChain.count({
      where: { organisationId, checkpointId: null },
    });

    const recentEntries = await prisma.journalEntry.findMany({
      where: { organisationId },
      orderBy: { date: "desc" },
      take: 8,
      include: { lines: true },
    });
    const recentIds = recentEntries.map((e) => e.id);
    const recentChain = await prisma.ledgerChain.findMany({
      where: { recordId: { in: recentIds }, recordType: "JOURNAL_ENTRY" },
      select: { recordId: true, checkpointId: true },
    });
    const chainByRecord = new Map(recentChain.map((c) => [c.recordId, c]));
    const recentTransactions = recentEntries.map((e) => ({
      id: e.id,
      date: e.date,
      description: e.description,
      amount: e.lines.reduce((s, l) => s + Number(l.debit), 0),
      chained: chainByRecord.has(e.id),
      checkpointed: !!chainByRecord.get(e.id)?.checkpointId,
    }));

    // Last 6 months income vs expense series for the dashboard chart.
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const seriesLines = await prisma.journalLine.findMany({
      where: { journalEntry: { organisationId, status: "POSTED", date: { gte: sixMonthsAgo } } },
      include: { account: true, journalEntry: { select: { date: true } } },
    });
    const monthBuckets = new Map<string, { income: number; expense: number }>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      monthBuckets.set(d.toISOString().slice(0, 7), { income: 0, expense: 0 });
    }
    for (const line of seriesLines) {
      const key = line.journalEntry.date.toISOString().slice(0, 7);
      const bucket = monthBuckets.get(key);
      if (!bucket) continue;
      if (line.account.type === "INCOME") bucket.income += Number(line.credit) - Number(line.debit);
      if (line.account.type === "EXPENSE") bucket.expense += Number(line.debit) - Number(line.credit);
    }
    const chartSeries = [...monthBuckets.entries()].map(([month, v]) => ({ month, ...v }));

    return NextResponse.json({
      totalAssets,
      totalLiabilities,
      netIncomeThisPeriod: incomeThisPeriod - expenseThisPeriod,
      pendingChainCount,
      recentTransactions,
      chartSeries,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
