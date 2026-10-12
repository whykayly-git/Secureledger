import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { COUNTED_ENTRY_STATUSES } from "@secureledger/ledger";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const accounts = await prisma.account.findMany({
      where: {
        organisationId: session.organisationId,
        type: { in: ["INCOME", "EXPENSE"] },
      },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              status: { in: [...COUNTED_ENTRY_STATUSES] },
              ...(from || to
                ? {
                    date: {
                      ...(from ? { gte: new Date(from) } : {}),
                      ...(to ? { lte: new Date(to) } : {}),
                    },
                  }
                : {}),
            },
          },
        },
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });

    const income = accounts
      .filter((a) => a.type === "INCOME")
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        amount: a.journalLines.reduce((sum, l) => sum + Number(l.credit) - Number(l.debit), 0),
      }));

    const expenses = accounts
      .filter((a) => a.type === "EXPENSE")
      .map((a) => ({
        accountId: a.id,
        code: a.code,
        name: a.name,
        amount: a.journalLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0),
      }));

    const totalIncome = income.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenses.reduce((sum, r) => sum + r.amount, 0);

    return NextResponse.json({
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
