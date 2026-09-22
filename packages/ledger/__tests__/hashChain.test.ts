import { computeChainHash } from "@secureledger/crypto";
import { appendLedgerChainEntry, journalEntryHashFields } from "../src";

/**
 * These tests exercise appendLedgerChainEntry's own logic — call ordering,
 * lock-key scoping, and how it derives hash/previousHash — against a
 * lightweight mocked Prisma transaction client, so they run fast with no
 * real database. They complement (not replace) the real, DB-backed
 * concurrency proof in apps/security-tests/__tests__/concurrency.test.ts,
 * which proves actual non-interleaving under real concurrent load against
 * real PostgreSQL locking. A mock cannot prove that guarantee itself —
 * only Postgres can — so these tests instead prove the function ALWAYS
 * acquires the lock (with the correct, per-organisation key) strictly
 * before it reads the current chain tip, which is the precondition the
 * database-level guarantee depends on.
 */
function createMockTx(tipHash: string | null = null) {
  const calls: string[] = [];
  const lockCallArgs: unknown[][] = [];
  const findFirstArgs: unknown[] = [];
  const createArgs: unknown[] = [];

  const tx = {
    $executeRaw: jest.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`lock`);
      lockCallArgs.push(values);
      return Promise.resolve(0);
    }),
    ledgerChain: {
      findFirst: jest.fn((args: unknown) => {
        calls.push("findFirst");
        findFirstArgs.push(args);
        return Promise.resolve(tipHash !== null ? { hash: tipHash } : null);
      }),
      create: jest.fn((args: unknown) => {
        calls.push("create");
        createArgs.push(args);
        const data = (args as { data: Record<string, unknown> }).data;
        return Promise.resolve({ id: "mock-chain-id", ...data });
      }),
    },
  };

  return { tx, calls, lockCallArgs, findFirstArgs, createArgs };
}

const baseParams = {
  organisationId: "org-A",
  recordType: "JOURNAL_ENTRY" as const,
  recordId: "record-1",
  fields: { amount: 100, description: "test entry" },
};

describe("appendLedgerChainEntry — advisory lock ordering and scoping", () => {
  it("acquires the advisory lock before reading the previous chain tip", async () => {
    const { tx, calls } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect(calls.indexOf("lock")).toBeLessThan(calls.indexOf("findFirst"));
  });

  it("acquires the advisory lock before creating the new chain row", async () => {
    const { tx, calls } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect(calls.indexOf("lock")).toBeLessThan(calls.indexOf("create"));
  });

  it("reads the previous tip before creating the new row (correct read-then-write order)", async () => {
    const { tx, calls } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect(calls.indexOf("findFirst")).toBeLessThan(calls.indexOf("create"));
  });

  it("calls the lock, tip-read, and create exactly once each per invocation", async () => {
    const { tx, calls } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect(calls).toEqual(["lock", "findFirst", "create"]);
  });

  it("derives the advisory lock key from the given organisationId", async () => {
    const { tx, lockCallArgs } = createMockTx();
    await appendLedgerChainEntry(tx as any, { ...baseParams, organisationId: "org-A" });
    expect(lockCallArgs[0]).toContain("org-A");
  });

  it("uses a different lock key argument for a different organisationId", async () => {
    const { tx: tx1, lockCallArgs: args1 } = createMockTx();
    const { tx: tx2, lockCallArgs: args2 } = createMockTx();
    await appendLedgerChainEntry(tx1 as any, { ...baseParams, organisationId: "org-A" });
    await appendLedgerChainEntry(tx2 as any, { ...baseParams, organisationId: "org-B" });
    expect(args1[0]).toContain("org-A");
    expect(args2[0]).toContain("org-B");
    expect(args1[0]).not.toEqual(args2[0]);
  });

  it("two concurrent calls for the SAME organisation each acquire their own lock call before their own tip-read — the lock is issued per call, not skipped on repeat", async () => {
    const { tx, calls } = createMockTx();
    await Promise.all([
      appendLedgerChainEntry(tx as any, { ...baseParams, recordId: "record-1" }),
      appendLedgerChainEntry(tx as any, { ...baseParams, recordId: "record-2" }),
    ]);
    // Two full (lock, findFirst, create) triples were issued — the mock's
    // instant resolution can't reproduce real lock *waiting*, but it does
    // prove the code path never skips acquiring the lock on any call.
    expect(calls.filter((c) => c === "lock").length).toBe(2);
    expect(calls.filter((c) => c === "findFirst").length).toBe(2);
    expect(calls.filter((c) => c === "create").length).toBe(2);
  });

  it("queries the previous tip scoped to the given organisationId, ordered newest-first", async () => {
    const { tx, findFirstArgs } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect(findFirstArgs[0]).toMatchObject({
      where: { organisationId: "org-A" },
      orderBy: [{ createdAt: "desc" }],
    });
  });
});

describe("appendLedgerChainEntry — hash and previousHash derivation", () => {
  it("sets previousHash to null when there is no prior chain tip (genesis)", async () => {
    const { tx, createArgs } = createMockTx(null);
    await appendLedgerChainEntry(tx as any, baseParams);
    expect((createArgs[0] as any).data.previousHash).toBeNull();
  });

  it("sets previousHash to the existing tip's hash when one exists", async () => {
    const { tx, createArgs } = createMockTx("existing-tip-hash");
    await appendLedgerChainEntry(tx as any, baseParams);
    expect((createArgs[0] as any).data.previousHash).toBe("existing-tip-hash");
  });

  it("computes the new hash using the SAME computeChainHash function the write path relies on", async () => {
    const { tx, createArgs } = createMockTx("existing-tip-hash");
    await appendLedgerChainEntry(tx as any, baseParams);
    const expectedHash = computeChainHash(baseParams.fields, "existing-tip-hash");
    expect((createArgs[0] as any).data.hash).toBe(expectedHash);
  });

  it("passes recordType, recordId, and organisationId through to the created row unchanged", async () => {
    const { tx, createArgs } = createMockTx();
    await appendLedgerChainEntry(tx as any, baseParams);
    expect((createArgs[0] as any).data).toMatchObject({
      organisationId: baseParams.organisationId,
      recordType: baseParams.recordType,
      recordId: baseParams.recordId,
    });
  });

  it("returns the row produced by the mock create call", async () => {
    const { tx } = createMockTx();
    const result = await appendLedgerChainEntry(tx as any, baseParams);
    expect(result.id).toBe("mock-chain-id");
  });

  it("integrates correctly with journalEntryHashFields for a realistic journal entry payload", async () => {
    const { tx, createArgs } = createMockTx(null);
    const entry = {
      id: "je-1",
      organisationId: "org-A",
      date: new Date("2026-01-01T00:00:00.000Z"),
      description: "Office supplies",
      status: "POSTED",
      createdById: "user-1",
      lines: [
        { accountId: "acc-expense", debit: 50, credit: 0 },
        { accountId: "acc-cash", debit: 0, credit: 50 },
      ],
    };
    await appendLedgerChainEntry(tx as any, {
      organisationId: "org-A",
      recordType: "JOURNAL_ENTRY",
      recordId: entry.id,
      fields: journalEntryHashFields(entry),
    });
    const expectedHash = computeChainHash(journalEntryHashFields(entry), null);
    expect((createArgs[0] as any).data.hash).toBe(expectedHash);
  });
});
