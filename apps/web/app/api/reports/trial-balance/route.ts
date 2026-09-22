import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = requireSession();

    const accounts = await prisma.account.findMany({
      where: { organisationId: session.organisationId },
      include: {
        journalLines: {
          where: { journalEntry: { status: "POSTED" } },
        },
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });

    const rows = accounts.map((account) => {
      const totalDebit = account.journalLines.reduce((sum, l) => sum + Number(l.debit), 0);
      const totalCredit = account.journalLines.reduce((sum, l) => sum + Number(l.credit), 0);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        totalDebit: acc.totalDebit + r.totalDebit,
        totalCredit: acc.totalCredit + r.totalCredit,
      }),
      { totalDebit: 0, totalCredit: 0 }
    );

    return NextResponse.json({ rows, totals });
  } catch (err) {
    return handleApiError(err);
  }
}
