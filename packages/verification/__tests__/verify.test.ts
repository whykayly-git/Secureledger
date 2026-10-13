import {
  buildMerkleTree,
  computeChainHash,
  generateSigningKeyPair,
  sha256Hex,
  signRoot,
} from "@secureledger/crypto";

const mockChainFindFirst = jest.fn();
const mockChainFindMany = jest.fn();
const mockCheckpointFindUnique = jest.fn();
const mockJournalEntryFindUnique = jest.fn();
const mockInvoiceFindUnique = jest.fn();

jest.mock("@secureledger/db", () => ({
  prisma: {
    ledgerChain: {
      findFirst: (...args: unknown[]) => mockChainFindFirst(...args),
      findMany: (...args: unknown[]) => mockChainFindMany(...args),
    },
    ledgerCheckpoint: {
      findUnique: (...args: unknown[]) => mockCheckpointFindUnique(...args),
    },
    journalEntry: {
      findFirst: (...args: unknown[]) => mockJournalEntryFindUnique(...args),
    },
    invoice: {
      findFirst: (...args: unknown[]) => mockInvoiceFindUnique(...args),
    },
  },
}));

// Imported after the mock is registered.
import { verifyLedgerChainEntryById } from "../src/verify";
import { journalEntryHashFields, invoiceHashFields } from "@secureledger/ledger";

const ORG_ID = "org-1";

function installPublicKey(publicKeyPem: string) {
  process.env.CHECKPOINT_PUBLIC_KEY = Buffer.from(publicKeyPem).toString("base64");
}

type MockEntry = {
  id: string;
  organisationId: string;
  date: Date;
  description: string;
  status: string;
  createdById: string;
  lines: { accountId: string; debit: number; credit: number }[];
};

function makeEntry(overrides: Partial<MockEntry> = {}): MockEntry {
  return {
    id: "record-1",
    organisationId: ORG_ID,
    date: new Date("2026-01-01T00:00:00.000Z"),
    description: "Test entry",
    status: "POSTED",
    createdById: "user-1",
    lines: [
      { accountId: "acc-expense", debit: 100, credit: 0 },
      { accountId: "acc-cash", debit: 0, credit: 100 },
    ],
    ...overrides,
  };
}

function realHashFor(entry: MockEntry, previousHash: string | null): string {
  return computeChainHash(journalEntryHashFields(entry), previousHash);
}

/**
 * Wires up the mocks for a single JOURNAL_ENTRY chain row and its
 * underlying record, mirroring exactly what verifyLedgerChainEntryById
 * queries: the chain row itself (by id), the immediately-preceding row
 * (by organisationId + createdAt < this row's createdAt, used for the
 * chain-link check), and the underlying JournalEntry (used for the
 * hash-recompute check).
 */
function setupChainRow(params: {
  chainId: string;
  entry: MockEntry;
  previousHash: string | null;
  priorRowHash: string | null; // the ACTUAL prior row's hash, or null if none exists
  checkpointId: string | null;
  createdAt?: Date;
  storedHashOverride?: string; // simulates directly tampering LedgerChain.hash
}) {
  const realHash = realHashFor(params.entry, params.previousHash);
  const storedHash = params.storedHashOverride ?? realHash;
  const createdAt = params.createdAt ?? new Date("2026-01-05T00:00:00.000Z");

  const chainRow = {
    id: params.chainId,
    organisationId: ORG_ID,
    recordId: params.entry.id,
    recordType: "JOURNAL_ENTRY",
    hash: storedHash,
    previousHash: params.previousHash,
    checkpointId: params.checkpointId,
    createdAt,
  };

  mockChainFindFirst.mockImplementation((args: any) => {
    if (args.where?.id === params.chainId) return Promise.resolve(chainRow);
    if (args.where?.createdAt) {
      return Promise.resolve(params.priorRowHash !== null ? { hash: params.priorRowHash } : null);
    }
    return Promise.resolve(null);
  });

  mockJournalEntryFindUnique.mockImplementation((args: any) =>
    Promise.resolve(
      args.where?.id === params.entry.id && args.where?.organisationId === params.entry.organisationId
        ? params.entry
        : null
    )
  );

  return { chainRow, realHash };
}

beforeEach(() => {
  mockChainFindFirst.mockReset();
  mockChainFindMany.mockReset();
  mockCheckpointFindUnique.mockReset();
  mockJournalEntryFindUnique.mockReset();
  mockInvoiceFindUnique.mockReset();
});

describe("verifyLedgerChainEntryById — not found / pending", () => {
  it("returns null when the chain entry does not exist", async () => {
    mockChainFindFirst.mockResolvedValue(null);
    const result = await verifyLedgerChainEntryById("missing-id", ORG_ID);
    expect(result).toBeNull();
  });

  it('returns verdict "pending" for an untouched, uncheckpointed genesis entry', async () => {
    setupChainRow({
      chainId: "chain-1",
      entry: makeEntry(),
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("pending");
    expect(mockCheckpointFindUnique).not.toHaveBeenCalled();
    expect(mockChainFindMany).not.toHaveBeenCalled();
  });

  it("includes recordId, recordType, hash and previousHash in the pending result", async () => {
    const entry = makeEntry({ id: "record-42" });
    setupChainRow({
      chainId: "chain-1",
      entry,
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result).toMatchObject({ recordId: "record-42", recordType: "JOURNAL_ENTRY" });
  });

  it("throws when the chain entry references a checkpointId that no longer exists", async () => {
    setupChainRow({
      chainId: "chain-1",
      entry: makeEntry(),
      previousHash: null,
      priorRowHash: null,
      checkpointId: "missing-checkpoint",
    });
    mockCheckpointFindUnique.mockResolvedValue(null);

    await expect(verifyLedgerChainEntryById("chain-1", ORG_ID)).rejects.toThrow(/missing checkpoint/i);
  });

  it("throws when the chain entry is not found within its own checkpoint's batch (data inconsistency)", async () => {
    setupChainRow({
      chainId: "chain-1",
      entry: makeEntry(),
      previousHash: null,
      priorRowHash: null,
      checkpointId: "checkpoint-1",
    });
    mockCheckpointFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot: "some-root",
      signature: "some-signature",
      rangeStart: new Date(),
      rangeEnd: new Date(),
      createdAt: new Date(),
    });
    mockChainFindMany.mockResolvedValue([{ id: "some-other-chain-row", hash: "other-hash" }]);

    await expect(verifyLedgerChainEntryById("chain-1", ORG_ID)).rejects.toThrow(/not found in its own checkpoint batch/i);
  });
});

describe("verifyLedgerChainEntryById — hash-recompute check (closes tamper scenario 1)", () => {
  it('reports "failed" with failureReason "hash_mismatch" when the underlying record was altered after chaining, even though the stored hash and checkpoint are otherwise untouched', async () => {
    const entry = makeEntry({ lines: [{ accountId: "acc-expense", debit: 999.99, credit: 0 }, { accountId: "acc-cash", debit: 0, credit: 999.99 }] });
    // storedHashOverride pins the hash to what it was BEFORE the record was
    // altered (i.e. the real write-time hash for the original amount), so
    // this reproduces "edit the row directly, leave LedgerChain.hash alone".
    const originalHash = realHashFor(makeEntry(), null);
    setupChainRow({
      chainId: "chain-1",
      entry, // current (tampered) record data
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
      storedHashOverride: originalHash, // stale hash from before the edit
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("hash_mismatch");
    }
  });

  it('reports "hash_mismatch" even when the record is fully checkpointed and validly signed', async () => {
    const keys = generateSigningKeyPair();
    installPublicKey(keys.publicKey);

    const entry = makeEntry({ description: "Tampered after checkpointing" });
    const originalHash = realHashFor(makeEntry(), null);
    const { chainRow } = setupChainRow({
      chainId: "chain-1",
      entry,
      previousHash: null,
      priorRowHash: null,
      checkpointId: "checkpoint-1",
      storedHashOverride: originalHash,
    });

    const tree = buildMerkleTree([chainRow.hash]);
    mockCheckpointFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot: tree.root,
      signature: signRoot(tree.root, keys.privateKey),
      rangeStart: new Date(),
      rangeEnd: new Date(),
      createdAt: new Date(),
    });
    mockChainFindMany.mockResolvedValue([{ id: "chain-1", hash: chainRow.hash }]);

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("hash_mismatch");
      // Never even reaches the Merkle/signature checks.
      expect(result.inclusionValid).toBe(false);
      expect(result.signatureValid).toBe(false);
    }
  });

  it('reports "hash_mismatch" when the underlying record has been deleted entirely', async () => {
    setupChainRow({
      chainId: "chain-1",
      entry: makeEntry(),
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
    });
    mockJournalEntryFindUnique.mockResolvedValue(null); // record no longer exists

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("hash_mismatch");
    }
  });

  it('reports "hash_mismatch" when the referenced record is real but belongs to a DIFFERENT organisation (cross-tenant reference)', async () => {
    // The chain row itself claims ORG_ID, but the JournalEntry it points at
    // (recordId) actually belongs to a different organisation. recomputeStoredHash
    // must scope its lookup by organisationId, not just id, or a cross-tenant
    // reference to real, unaltered data would recompute successfully.
    const entryFromAnotherOrg = makeEntry({ organisationId: "org-2-not-this-one" });
    setupChainRow({
      chainId: "chain-1",
      entry: entryFromAnotherOrg,
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("hash_mismatch");
    }
  });
});

describe("verifyLedgerChainEntryById — chain-link continuity check (closes tamper scenario 3)", () => {
  it('reports "failed" with failureReason "chain_link_broken" for a self-consistent forged previousHash (hash recomputed to match the forgery)', async () => {
    // A more sophisticated forgery than a naive previousHash edit: the
    // attacker also recomputes a hash that's internally consistent with
    // the forged previousHash, so the hash-recompute check alone can't
    // catch it — only checking the link against the REAL prior row can.
    const entry = makeEntry();
    const forgedPreviousHash = sha256Hex("forged-predecessor");
    const actualPriorRowHash = sha256Hex("the-real-predecessor-hash");

    setupChainRow({
      chainId: "chain-2",
      entry,
      previousHash: forgedPreviousHash,
      priorRowHash: actualPriorRowHash, // does NOT match forgedPreviousHash
      checkpointId: null,
      // No storedHashOverride: the stored hash IS computeChainHash(entry, forgedPreviousHash),
      // i.e. self-consistent with the forgery, so hash_mismatch will NOT fire.
    });

    const result = await verifyLedgerChainEntryById("chain-2", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("chain_link_broken");
    }
  });

  it('reports "chain_link_broken" when a row falsely claims to be genesis while a real predecessor exists', async () => {
    const entry = makeEntry();
    setupChainRow({
      chainId: "chain-2",
      entry,
      previousHash: null, // claims genesis
      priorRowHash: sha256Hex("a-real-predecessor-exists"), // but one exists
      checkpointId: null,
    });

    const result = await verifyLedgerChainEntryById("chain-2", ORG_ID);

    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("chain_link_broken");
    }
  });

  it("does not report chain_link_broken for a correctly-linked, untampered entry", async () => {
    const priorHash = sha256Hex("real-prior-hash");
    const entry = makeEntry();
    setupChainRow({
      chainId: "chain-2",
      entry,
      previousHash: priorHash,
      priorRowHash: priorHash, // matches
      checkpointId: null,
    });

    const result = await verifyLedgerChainEntryById("chain-2", ORG_ID);

    expect(result?.verdict).toBe("pending"); // not checkpointed, but internally consistent
  });
});

describe("verifyLedgerChainEntryById — checkpointed records (single and multi-leaf batches)", () => {
  const keys = generateSigningKeyPair();

  function mockCheckpointedEntry(
    entries: MockEntry[],
    leafIndex: number,
    options?: { signatureOverride?: string; rootOverride?: string }
  ) {
    // Build a real, self-consistent chain across all entries in the batch.
    const hashes: string[] = [];
    let prev: string | null = null;
    for (const e of entries) {
      const h = realHashFor(e, prev);
      hashes.push(h);
      prev = h;
    }

    const tree = buildMerkleTree(hashes);
    const signature = options?.signatureOverride ?? signRoot(tree.root, keys.privateKey);
    const merkleRoot = options?.rootOverride ?? tree.root;

    const batch = hashes.map((hash, i) => ({ id: `chain-${i}`, hash }));

    mockChainFindFirst.mockImplementation((args: any) => {
      if (args.where?.id === `chain-${leafIndex}`) {
        return Promise.resolve({
          id: `chain-${leafIndex}`,
          organisationId: ORG_ID,
          recordId: entries[leafIndex].id,
          recordType: "JOURNAL_ENTRY",
          hash: hashes[leafIndex],
          previousHash: leafIndex === 0 ? null : hashes[leafIndex - 1],
          checkpointId: "checkpoint-1",
          createdAt: new Date(2026, 0, 1, 0, 0, leafIndex),
        });
      }
      if (args.where?.createdAt) {
        return Promise.resolve(leafIndex === 0 ? null : { hash: hashes[leafIndex - 1] });
      }
      return Promise.resolve(null);
    });

    mockJournalEntryFindUnique.mockImplementation((args: any) => {
      const match = entries.find((e) => e.id === args.where?.id);
      return Promise.resolve(match ?? null);
    });

    mockCheckpointFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot,
      signature,
      rangeStart: new Date("2026-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-02T00:00:01.000Z"),
    });
    mockChainFindMany.mockResolvedValue(batch);

    return { tree, hashes };
  }

  beforeEach(() => {
    installPublicKey(keys.publicKey);
  });

  it("returns verified for a single-leaf checkpoint batch", async () => {
    const entries = [makeEntry({ id: "record-0" })];
    mockCheckpointedEntry(entries, 0);
    const result = await verifyLedgerChainEntryById(`chain-0`, ORG_ID);
    expect(result?.verdict).toBe("verified");
  });

  it.each([3, 5, 8])("returns verified for every leaf position in a %i-entry checkpoint batch", async (size) => {
    const entries = Array.from({ length: size }, (_, i) => makeEntry({ id: `record-${i}`, description: `Entry ${i}` }));
    for (let leafIndex = 0; leafIndex < size; leafIndex++) {
      mockCheckpointedEntry(entries, leafIndex);
      const result = await verifyLedgerChainEntryById(`chain-${leafIndex}`, ORG_ID);
      expect(result?.verdict).toBe("verified");
    }
  });

  it("reports the correct leafIndex and totalLeaves for a batch", async () => {
    const entries = Array.from({ length: 6 }, (_, i) => makeEntry({ id: `record-${i}`, description: `Entry ${i}` }));
    mockCheckpointedEntry(entries, 4);
    const result = await verifyLedgerChainEntryById("chain-4", ORG_ID);
    expect(result).toMatchObject({ leafIndex: 4 });
    if (result && result.verdict !== "pending") {
      expect(result.checkpoint?.totalLeaves).toBe(6);
    }
  });

  it("keeps the inclusion proof logarithmic in batch size", async () => {
    const entries = Array.from({ length: 1024 }, (_, i) => makeEntry({ id: `record-${i}`, description: `Entry ${i}` }));
    mockCheckpointedEntry(entries, 500);
    const result = await verifyLedgerChainEntryById("chain-500", ORG_ID);
    if (result && result.verdict !== "pending") {
      expect(result.proof?.length).toBeLessThanOrEqual(10); // ceil(log2(1024)) = 10
    }
  });

  it("returns failed when the checkpoint signature does not validate against the public key", async () => {
    const entries = Array.from({ length: 4 }, (_, i) => makeEntry({ id: `record-${i}`, description: `Entry ${i}` }));
    const otherKeys = generateSigningKeyPair();
    const { tree } = mockCheckpointedEntry(entries, 1);
    mockCheckpointFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot: tree.root,
      signature: signRoot(tree.root, otherKeys.privateKey),
      rangeStart: new Date(),
      rangeEnd: new Date(),
      createdAt: new Date(),
    });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBe("signature_invalid");
      expect(result.signatureValid).toBe(false);
    }
  });

  it("returns failed when the checkpoint's merkleRoot has been tampered with", async () => {
    const entries = Array.from({ length: 4 }, (_, i) => makeEntry({ id: `record-${i}`, description: `Entry ${i}` }));
    mockCheckpointedEntry(entries, 1, { rootOverride: sha256Hex("forged-root") });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
  });

  it("includes checkpoint rangeStart/rangeEnd/id in a verified result", async () => {
    const entries = [makeEntry({ id: "record-0" })];
    mockCheckpointedEntry(entries, 0);
    const result = await verifyLedgerChainEntryById("chain-0", ORG_ID);
    if (result && result.verdict !== "pending") {
      expect(result.checkpoint?.id).toBe("checkpoint-1");
      expect(result.checkpoint?.rangeStart).toBeInstanceOf(Date);
      expect(result.checkpoint?.rangeEnd).toBeInstanceOf(Date);
    } else {
      throw new Error("expected a non-pending result");
    }
  });
});

describe("verifyLedgerChainEntryById — control (no regressions on the untampered path)", () => {
  it("returns verified for a fully untouched, correctly checkpointed, correctly linked entry", async () => {
    const keys = generateSigningKeyPair();
    installPublicKey(keys.publicKey);

    const first = makeEntry({ id: "record-0", description: "Opening balance" });
    const second = makeEntry({ id: "record-1", description: "Second entry" });
    const firstHash = realHashFor(first, null);
    const secondHash = realHashFor(second, firstHash);

    const batch = [
      { id: "chain-0", hash: firstHash },
      { id: "chain-1", hash: secondHash },
    ];

    mockChainFindFirst.mockImplementation((args: any) => {
      if (args.where?.id === "chain-1") {
        return Promise.resolve({
          id: "chain-1",
          organisationId: ORG_ID,
          recordId: "record-1",
          recordType: "JOURNAL_ENTRY",
          hash: secondHash,
          previousHash: firstHash,
          checkpointId: "checkpoint-1",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
        });
      }
      if (args.where?.createdAt) {
        return Promise.resolve({ hash: firstHash });
      }
      return Promise.resolve(null);
    });
    mockJournalEntryFindUnique.mockImplementation((args: any) =>
      Promise.resolve(args.where?.id === "record-1" ? second : null)
    );

    const tree = buildMerkleTree(batch.map((b) => b.hash));
    mockCheckpointFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot: tree.root,
      signature: signRoot(tree.root, keys.privateKey),
      rangeStart: new Date(),
      rangeEnd: new Date(),
      createdAt: new Date(),
    });
    mockChainFindMany.mockResolvedValue(batch);

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("verified");
    if (result && result.verdict !== "pending") {
      expect(result.failureReason).toBeNull();
    }
  });
});

describe("verifyLedgerChainEntryById — voided journal entries", () => {
  const postedHash = () => realHashFor(makeEntry({ status: "POSTED" }), null);

  function installVoidedEntry(reversal: { id: string } | null) {
    const voided = makeEntry({ status: "VOID" });
    setupChainRow({
      chainId: "chain-1",
      entry: voided,
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
      storedHashOverride: postedHash(), // the hash was computed when the entry was POSTED
    });
    mockJournalEntryFindUnique.mockImplementation((args: any) => {
      if (args.where?.reversalOfEntryId) return Promise.resolve(reversal);
      return Promise.resolve(args.where?.id === voided.id ? voided : null);
    });
  }

  it("does not flag an entry that was legitimately voided (a reversing entry exists)", async () => {
    installVoidedEntry({ id: "reversing-1" });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("pending");
  });

  it("still flags a status flipped to VOID when no reversing entry exists", async () => {
    installVoidedEntry(null);
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") expect(result.failureReason).toBe("hash_mismatch");
  });

  it("still flags an amount changed on a voided entry, even though a reversing entry exists", async () => {
    const voided = makeEntry({ status: "VOID", lines: [
      { accountId: "acc-expense", debit: 999, credit: 0 },
      { accountId: "acc-cash", debit: 0, credit: 999 },
    ] });
    setupChainRow({
      chainId: "chain-1",
      entry: voided,
      previousHash: null,
      priorRowHash: null,
      checkpointId: null,
      storedHashOverride: postedHash(),
    });
    mockJournalEntryFindUnique.mockImplementation((args: any) =>
      args.where?.reversalOfEntryId ? Promise.resolve({ id: "reversing-1" }) : Promise.resolve(voided)
    );
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
  });
});

describe("verifyLedgerChainEntryById — invoice lifecycle rows", () => {
  const baseInvoice = {
    id: "inv-1",
    organisationId: ORG_ID,
    customerName: "Acme",
    lineItems: { items: [{ description: "Work", quantity: 1, unitPrice: 100, incomeAccountId: "inc-1" }], receivableAccountId: "cash-1" },
    amount: 100,
    dueDate: new Date("2026-02-01T00:00:00.000Z"),
  };

  /** Chains one row per status, as the issue/pay/void routes do, then points the DB at `currentStatus`. */
  function installInvoice(statuses: string[], currentStatus: string, dbOverrides: Record<string, unknown> = {}) {
    const rows: { id: string; hash: string; previousHash: string | null; createdAt: Date }[] = [];
    let previous: string | null = null;
    statuses.forEach((status, i) => {
      const hash = computeChainHash(invoiceHashFields({ ...baseInvoice, status }), previous);
      rows.push({ id: `chain-${i}`, hash, previousHash: previous, createdAt: new Date(2026, 0, 5, 0, i) });
      previous = hash;
    });

    mockChainFindFirst.mockImplementation((args: any) => {
      if (args.where?.id) {
        const row = rows.find((r) => r.id === args.where.id);
        return Promise.resolve(
          row ? { ...row, organisationId: ORG_ID, recordId: baseInvoice.id, recordType: "INVOICE", checkpointId: null } : null
        );
      }
      if (args.where?.createdAt) {
        const before = rows.filter((r) => r.createdAt < args.where.createdAt.lt);
        return Promise.resolve(before.length ? { hash: before[before.length - 1].hash } : null);
      }
      return Promise.resolve(null);
    });
    mockChainFindMany.mockImplementation((args: any) =>
      args.where?.recordType === "INVOICE" ? Promise.resolve(rows.map((r) => ({ id: r.id }))) : Promise.resolve([])
    );
    mockInvoiceFindUnique.mockResolvedValue({ ...baseInvoice, status: currentStatus, ...dbOverrides });
  }

  it("verifies every row of a created, issued and paid invoice, not only the newest", async () => {
    installInvoice(["DRAFT", "ISSUED", "PAID"], "PAID");
    for (const id of ["chain-0", "chain-1", "chain-2"]) {
      const result = await verifyLedgerChainEntryById(id, ORG_ID);
      expect(result?.verdict).toBe("pending");
    }
  });

  it("verifies every row of an invoice that was paid and then voided", async () => {
    installInvoice(["DRAFT", "ISSUED", "PAID", "VOIDED"], "VOIDED");
    for (const id of ["chain-0", "chain-1", "chain-2", "chain-3"]) {
      const result = await verifyLedgerChainEntryById(id, ORG_ID);
      expect(result?.verdict).toBe("pending");
    }
  });

  it("verifies every row of an invoice voided straight after being issued", async () => {
    installInvoice(["DRAFT", "ISSUED", "VOIDED"], "VOIDED");
    for (const id of ["chain-0", "chain-1", "chain-2"]) {
      const result = await verifyLedgerChainEntryById(id, ORG_ID);
      expect(result?.verdict).toBe("pending");
    }
  });

  it("flags every row when the invoice amount is altered after the fact", async () => {
    installInvoice(["DRAFT", "ISSUED", "PAID"], "PAID", { amount: 5 });
    for (const id of ["chain-0", "chain-1", "chain-2"]) {
      const result = await verifyLedgerChainEntryById(id, ORG_ID);
      expect(result?.verdict).toBe("failed");
    }
  });

  it("flags rows whose count fits no legal lifecycle path (for example a missing draft row)", async () => {
    installInvoice(["ISSUED", "PAID"], "PAID");
    for (const id of ["chain-0", "chain-1"]) {
      const result = await verifyLedgerChainEntryById(id, ORG_ID);
      expect(result?.verdict).toBe("failed");
    }
  });

  it("flags the newest row when the invoice's current status was changed without a matching chain row", async () => {
    installInvoice(["DRAFT", "ISSUED", "PAID"], "VOIDED");
    const result = await verifyLedgerChainEntryById("chain-2", ORG_ID);
    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") expect(result.failureReason).toBe("hash_mismatch");
  });
});
