import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireRole, requireSession } from "@/lib/session";
import { handleApiError } from "@/lib/api";
import { verifyLedgerChainEntryById } from "@secureledger/verification";

/** Auditor-only: verifies every ledger chain entry for the org and returns a CSV export. */
export async function GET() {
  try {
    const session = requireSession();
    requireRole(session, "AUDITOR");

    const chainRows = await prisma.ledgerChain.findMany({
      where: { organisationId: session.organisationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const rows: string[] = [
      "chainId,recordType,recordId,createdAt,verdict,failureReason,checkpointId,merkleRoot,signatureValid,inclusionValid",
    ];

    for (const row of chainRows) {
      const result = await verifyLedgerChainEntryById(row.id, session.organisationId);
      if (!result) continue;
      if (result.verdict === "pending") {
        rows.push(
          `${result.chainId},${result.recordType},${result.recordId},${result.createdAt.toISOString()},pending,,,,,`
        );
      } else {
        rows.push(
          [
            result.chainId,
            result.recordType,
            result.recordId,
            result.createdAt.toISOString(),
            result.verdict,
            result.failureReason ?? "",
            result.checkpoint?.id ?? "",
            result.checkpoint?.merkleRoot ?? "",
            result.signatureValid,
            result.inclusionValid,
          ].join(",")
        );
      }
    }

    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="secureledger-audit-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
