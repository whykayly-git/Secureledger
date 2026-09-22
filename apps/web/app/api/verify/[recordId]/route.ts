import { NextResponse } from "next/server";
import { prisma } from "@secureledger/db";
import { requireSession } from "@/lib/session";
import { ApiError, handleApiError } from "@/lib/api";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import { timed } from "@secureledger/ledger";

export type VoidInfo = {
  isVoided: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  reversingEntryId: string | null;
  isReversingEntry: boolean;
  reversalOfEntryId: string | null;
};

/**
 * Looks up whether a verified record has since been voided (and, if it's
 * a reversing entry itself, what it reverses) — purely informational
 * context alongside the cryptographic verdict, never a factor in it.
 */
async function loadVoidInfo(recordType: string, recordId: string): Promise<VoidInfo> {
  const empty: VoidInfo = {
    isVoided: false,
    voidedAt: null,
    voidReason: null,
    reversingEntryId: null,
    isReversingEntry: false,
    reversalOfEntryId: null,
  };

  if (recordType === "JOURNAL_ENTRY") {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: recordId },
      select: {
        status: true,
        voidedAt: true,
        voidReason: true,
        reversalOfEntryId: true,
        reversedByEntry: { select: { id: true } },
      },
    });
    if (!entry) return empty;
    return {
      isVoided: entry.status === "VOID",
      voidedAt: entry.voidedAt?.toISOString() ?? null,
      voidReason: entry.voidReason,
      reversingEntryId: entry.reversedByEntry?.id ?? null,
      isReversingEntry: entry.reversalOfEntryId !== null,
      reversalOfEntryId: entry.reversalOfEntryId,
    };
  }

  if (recordType === "INVOICE") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: recordId },
      select: { status: true, voidedAt: true, voidReason: true, relatedJournalEntryId: true },
    });
    if (!invoice) return empty;
    let reversingEntryId: string | null = null;
    if (invoice.status === "VOIDED" && invoice.relatedJournalEntryId) {
      const reversal = await prisma.journalEntry.findFirst({
        where: { reversalOfEntryId: invoice.relatedJournalEntryId },
        select: { id: true },
      });
      reversingEntryId = reversal?.id ?? null;
    }
    return {
      isVoided: invoice.status === "VOIDED",
      voidedAt: invoice.voidedAt?.toISOString() ?? null,
      voidReason: invoice.voidReason,
      reversingEntryId,
      isReversingEntry: false,
      reversalOfEntryId: null,
    };
  }

  return empty;
}

export async function GET(request: Request, { params }: { params: { recordId: string } }) {
  try {
    const session = requireSession();

    const rate = checkRateLimit(`verify:${clientKeyFromRequest(request)}`, 60, 60_000);
    if (!rate.allowed) {
      throw new ApiError("Too many verification requests. Try again shortly.", 429);
    }

    const { searchParams } = new URL(request.url);
    const chainId = searchParams.get("chainId");

    const targetChainId =
      chainId ??
      (
        await prisma.ledgerChain.findFirst({
          where: { recordId: params.recordId, organisationId: session.organisationId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      )?.id;

    if (!targetChainId) {
      throw new ApiError("No ledger chain entry found for this record", 404);
    }

    // Benchmark instrumentation only — isolates verification's own
    // processing time (Merkle proof rebuild + signature check) from
    // request/response overhead, without changing what it returns.
    const { result, durationMs } = await timed(() => verifyLedgerChainEntryById(targetChainId, session.organisationId));
    if (!result) {
      throw new ApiError("No ledger chain entry found for this record", 404);
    }

    // Voiding never touches a record's original data/hash/chain position,
    // so the verification verdict above is already correct on its own —
    // this only adds informational context so the UI can show "voided",
    // never conflating that with "tampered".
    const voidInfo = await loadVoidInfo(result.recordType, result.recordId);

    return NextResponse.json(
      { ...result, voidInfo },
      { headers: { "X-Verification-Latency-Ms": durationMs.toFixed(3) } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
