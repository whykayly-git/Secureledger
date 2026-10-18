import { prisma } from "@secureledger/db";
import { generateSigningKeyPair } from "@secureledger/crypto";
import { appendLedgerChainEntry, journalEntryHashFields } from "@secureledger/ledger";
import { runCheckpointCycle } from "@secureledger/checkpoint-worker/cycle";

/**
 * Shared ECDSA key pair for the whole suite run. Generated once so every
 * scenario's checkpoints are signed with the same key, and the public half
 * is installed into CHECKPOINT_PUBLIC_KEY (exactly how apps/web is
 * configured) so the real, unmodified verification package can check
 * signatures without any test-only shortcuts.
 */
export type TestKeys = { publicKeyPem: string; privateKeyPem: string };

let cachedKeys: TestKeys | null = null;

export function getTestKeys(): TestKeys {
  if (!cachedKeys) {
    const { publicKey, privateKey } = generateSigningKeyPair();
    cachedKeys = { publicKeyPem: publicKey, privateKeyPem: privateKey };
  }
  // verifyLedgerChainEntryById reads this env var on every call via
  // @secureledger/verification's getCheckpointPublicKey() — same contract
  // apps/web relies on in production.
  process.env.CHECKPOINT_PUBLIC_KEY = Buffer.from(cachedKeys.publicKeyPem).toString("base64");
  return cachedKeys;
}

export type TestOrgContext = {
  organisationId: string;
  userId: string;
  cashAccountId: string;
  expenseAccountId: string;
};

function uniqueSuffix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a fully isolated organisation (own org/user/accounts) for one
 * scenario. Scenarios never share an organisationId, so they can't
 * interfere with each other even when run concurrently — no shared
 * transaction/rollback trickery required.
 */
export async function createTestOrganisation(label: string): Promise<TestOrgContext> {
  const suffix = uniqueSuffix(label);

  const org = await prisma.organisation.create({ data: { name: `Tamper-Test-${suffix}` } });
  const user = await prisma.user.create({
    data: {
      name: "Security Test Runner",
      email: `sectest-${suffix}@example.com`,
      passwordHash: "not-a-real-hash-this-user-never-logs-in",
      role: "ACCOUNTANT",
      organisationId: org.id,
    },
  });
  const cashAccount = await prisma.account.create({
    data: { organisationId: org.id, name: "Cash", type: "ASSET", code: `1000-${suffix.slice(-6)}` },
  });
  const expenseAccount = await prisma.account.create({
    data: { organisationId: org.id, name: "Office Supplies", type: "EXPENSE", code: `5000-${suffix.slice(-6)}` },
  });

  return {
    organisationId: org.id,
    userId: user.id,
    cashAccountId: cashAccount.id,
    expenseAccountId: expenseAccount.id,
  };
}

/**
 * Posts a real, balanced journal entry through the EXACT same write path
 * apps/web's /api/journal-entries route uses (appendLedgerChainEntry +
 * journalEntryHashFields from @secureledger/ledger, inside the same DB
 * transaction) — not a reimplementation of hash-chaining.
 */
export async function postJournalEntry(ctx: TestOrgContext, description: string, amount: number) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        organisationId: ctx.organisationId,
        date: new Date(),
        description,
        status: "POSTED",
        createdById: ctx.userId,
        lines: {
          create: [
            { accountId: ctx.expenseAccountId, debit: amount, credit: 0 },
            { accountId: ctx.cashAccountId, debit: 0, credit: amount },
          ],
        },
      },
      include: { lines: true },
    });

    const chainEntry = await appendLedgerChainEntry(tx, {
      organisationId: ctx.organisationId,
      recordType: "JOURNAL_ENTRY",
      recordId: entry.id,
      fields: journalEntryHashFields(entry),
    });

    return { entry, chainEntry };
  });
}

/**
 * Runs one real checkpoint cycle by calling the checkpoint-worker's own
 * core orchestration function directly (in-process), not over HTTP and
 * not a reimplementation — the exact same runCheckpointCycle the worker's
 * scheduling loop calls every poll interval in production.
 *
 * maxIntervalMs: 0 forces the interval condition to fire immediately,
 * since each scenario's organisation has no prior checkpoint.
 */
export async function runCheckpoint(): Promise<void> {
  const keys = getTestKeys();
  await runCheckpointCycle(prisma, {
    batchThreshold: 500,
    maxIntervalMs: 0,
    privateKeyPem: keys.privateKeyPem,
  });
}

/**
 * Same real orchestration function as runCheckpoint(), but with a caller-
 * supplied maxIntervalMs instead of the forced-immediate 0 — used by the
 * category (b) deletion-window trials to exercise the ACTUAL timer
 * behaviour a deployment would see with CHECKPOINT_MAX_INTERVAL_MS set to
 * a given value (apps/checkpoint-worker/src/config.ts), rather than
 * always forcing a checkpoint regardless of elapsed time.
 *
 * Note decideCheckpoint's own first-checkpoint-ever exception
 * (packages/../checkpoint-worker/src/checkpoint.ts): an organisation with
 * NO prior checkpoint always checkpoints immediately on the next cycle
 * regardless of maxIntervalMs. So a genuine "does the interval matter"
 * test needs an established lastCheckpointAt first — see the trials that
 * use this function for how they set that up.
 */
export async function runCheckpointWithInterval(maxIntervalMs: number): Promise<void> {
  const keys = getTestKeys();
  await runCheckpointCycle(prisma, {
    batchThreshold: 500,
    maxIntervalMs,
    privateKeyPem: keys.privateKeyPem,
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deletes everything created for one scenario's organisation, in FK
 * dependency order, so repeated suite runs don't accumulate test data in
 * the dev/CI database.
 */
export async function teardownOrganisation(organisationId: string): Promise<void> {
  const entries = await prisma.journalEntry.findMany({
    where: { organisationId },
    select: { id: true },
  });
  const entryIds = entries.map((e) => e.id);

  await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
  await prisma.ledgerChain.deleteMany({ where: { organisationId } });
  await prisma.invoice.deleteMany({ where: { organisationId } });
  await prisma.journalEntry.deleteMany({ where: { organisationId } });
  await prisma.ledgerCheckpoint.deleteMany({ where: { organisationId } });
  await prisma.adminActionLog.deleteMany({ where: { organisationId } });
  await prisma.verificationRun.deleteMany({ where: { organisationId } });
  await prisma.account.deleteMany({ where: { organisationId } });
  await prisma.user.deleteMany({ where: { organisationId } });
  await prisma.organisation.delete({ where: { id: organisationId } });
}

export async function disconnectHarness(): Promise<void> {
  await prisma.$disconnect();
}
