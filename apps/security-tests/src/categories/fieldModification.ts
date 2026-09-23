import { prisma } from "@secureledger/db";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation, TestOrgContext } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (a) — Field-level modification (16 trials).
 *
 * Directly UPDATEs a single JournalEntry/JournalLine field via Prisma —
 * amount, account, date, or narration (description) — leaving the stored
 * LedgerChain hash untouched. Closed entirely by Part 1's hash-recompute
 * fix (verifyLedgerChainEntryById never trusts a stored hash without
 * recomputing it from the record's CURRENT data), which the task confirms
 * runs on every verdict path — so all 4 x (checkpointed/pending) x
 * (sole entry/middle-of-3-chain) combinations are expected to be caught.
 */

type FieldName = "amount" | "account" | "date" | "narration";

async function buildChain(ctx: TestOrgContext, size: number, checkpointed: boolean) {
  const posted = [];
  for (let i = 0; i < size; i++) {
    posted.push(await postJournalEntry(ctx, `Field-mod test entry ${i + 1}`, 100 + i * 10));
  }
  if (checkpointed) {
    await runCheckpoint();
  }
  return posted;
}

async function tamperField(fieldName: FieldName, entryId: string, ctx: TestOrgContext): Promise<string> {
  switch (fieldName) {
    case "amount": {
      const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: entryId, debit: { gt: 0 } } });
      await prisma.journalLine.update({ where: { id: line.id }, data: { debit: Number(line.debit) + 555.55 } });
      return `JournalLine ${line.id} debit changed from ${line.debit} to ${Number(line.debit) + 555.55}`;
    }
    case "account": {
      const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: entryId, debit: { gt: 0 } } });
      const altAccount = await prisma.account.create({
        data: {
          organisationId: ctx.organisationId,
          name: "Alternate Diversion Account",
          type: "EXPENSE",
          code: `9${Date.now().toString().slice(-8)}`,
        },
      });
      await prisma.journalLine.update({ where: { id: line.id }, data: { accountId: altAccount.id } });
      return `JournalLine ${line.id} accountId redirected from ${line.accountId} to a different account (${altAccount.id}), diverting the posting`;
    }
    case "date": {
      const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
      const newDate = new Date(entry.date.getTime() - 30 * 24 * 60 * 60 * 1000);
      await prisma.journalEntry.update({ where: { id: entryId }, data: { date: newDate } });
      return `JournalEntry ${entryId} date backdated from ${entry.date.toISOString()} to ${newDate.toISOString()}`;
    }
    case "narration": {
      const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
      const newDescription = "Innocuous supplies purchase";
      await prisma.journalEntry.update({ where: { id: entryId }, data: { description: newDescription } });
      return `JournalEntry ${entryId} description changed from "${entry.description}" to "${newDescription}"`;
    }
  }
}

async function fieldTrial(
  id: string,
  fieldName: FieldName,
  checkpointed: boolean,
  chainSize: 1 | 3
): Promise<TrialResult> {
  const label = `(a-${id}) ${fieldName} tampered, ${checkpointed ? "checkpointed" : "pending"}, ${chainSize === 1 ? "sole entry" : "middle of 3-entry chain"}`;
  const ctx = await createTestOrganisation(`a-${id}-${fieldName}`);
  try {
    return await runTrial(`a-${id}`, label, async () => {
      const posted = await buildChain(ctx, chainSize, checkpointed);
      const target = posted[chainSize === 3 ? 1 : 0];

      const tamperDescription = await tamperField(fieldName, target.entry.id, ctx);
      const result = await verifyLedgerChainEntryById(target.chainEntry.id, ctx.organisationId);

      const detected = result?.verdict === "failed";
      return {
        detected,
        detail: `${tamperDescription}. Verdict: ${result?.verdict} (failureReason: ${
          result && "failureReason" in result ? result.failureReason : "n/a"
        }).`,
      };
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

export async function runFieldModificationCategory(): Promise<TrialResult[]> {
  const fields: FieldName[] = ["amount", "account", "date", "narration"];
  const results: TrialResult[] = [];
  let n = 1;
  for (const field of fields) {
    results.push(await fieldTrial(String(n++), field, true, 1));
    results.push(await fieldTrial(String(n++), field, false, 1));
    results.push(await fieldTrial(String(n++), field, true, 3));
    results.push(await fieldTrial(String(n++), field, false, 3));
  }
  return results;
}
