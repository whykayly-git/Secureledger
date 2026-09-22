import { buildMerkleTree, generateSigningKeyPair, sha256Hex, signRoot } from "@secureledger/crypto";

const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();

jest.mock("@secureledger/db", () => ({
  prisma: {
    ledgerChain: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    ledgerCheckpoint: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

// Imported after the mock is registered.
import { verifyLedgerChainEntryById } from "../src/verify";

const ORG_ID = "org-1";

function installPublicKey(publicKeyPem: string) {
  process.env.CHECKPOINT_PUBLIC_KEY = Buffer.from(publicKeyPem).toString("base64");
}

beforeEach(() => {
  mockFindFirst.mockReset();
  mockFindUnique.mockReset();
  mockFindMany.mockReset();
});

describe("verifyLedgerChainEntryById — not found / pending", () => {
  it("returns null when the chain entry does not exist", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await verifyLedgerChainEntryById("missing-id", ORG_ID);
    expect(result).toBeNull();
  });

  it("scopes the chain-entry lookup to the given id and organisationId", async () => {
    mockFindFirst.mockResolvedValue(null);
    await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: "chain-1", organisationId: ORG_ID } });
  });

  it('returns verdict "pending" when checkpointId is null, without querying any checkpoint', async () => {
    mockFindFirst.mockResolvedValue({
      id: "chain-1",
      recordId: "record-1",
      recordType: "JOURNAL_ENTRY",
      hash: "abc123",
      previousHash: null,
      checkpointId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result?.verdict).toBe("pending");
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("includes recordId, recordType, hash and previousHash in the pending result", async () => {
    mockFindFirst.mockResolvedValue({
      id: "chain-1",
      recordId: "record-42",
      recordType: "INVOICE",
      hash: "hash-42",
      previousHash: "prev-hash-41",
      checkpointId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);

    expect(result).toMatchObject({
      recordId: "record-42",
      recordType: "INVOICE",
      hash: "hash-42",
      previousHash: "prev-hash-41",
    });
  });

  it("throws when the chain entry references a checkpointId that no longer exists", async () => {
    mockFindFirst.mockResolvedValue({
      id: "chain-1",
      recordId: "record-1",
      recordType: "JOURNAL_ENTRY",
      hash: "abc123",
      previousHash: null,
      checkpointId: "missing-checkpoint",
      createdAt: new Date(),
    });
    mockFindUnique.mockResolvedValue(null);

    await expect(verifyLedgerChainEntryById("chain-1", ORG_ID)).rejects.toThrow(/missing checkpoint/i);
  });

  it("throws when the chain entry is not found within its own checkpoint's batch (data inconsistency)", async () => {
    mockFindFirst.mockResolvedValue({
      id: "chain-1",
      recordId: "record-1",
      recordType: "JOURNAL_ENTRY",
      hash: "abc123",
      previousHash: null,
      checkpointId: "checkpoint-1",
      createdAt: new Date(),
    });
    mockFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot: "some-root",
      signature: "some-signature",
      rangeStart: new Date(),
      rangeEnd: new Date(),
      createdAt: new Date(),
    });
    mockFindMany.mockResolvedValue([{ id: "some-other-chain-row", hash: "other-hash" }]);

    await expect(verifyLedgerChainEntryById("chain-1", ORG_ID)).rejects.toThrow(/not found in its own checkpoint batch/i);
  });
});

describe("verifyLedgerChainEntryById — checkpointed records (single and multi-leaf batches)", () => {
  const keys = generateSigningKeyPair();

  function mockCheckpointedEntry(batchHashes: string[], leafIndex: number, options?: { signatureOverride?: string; rootOverride?: string }) {
    const tree = buildMerkleTree(batchHashes);
    const signature = options?.signatureOverride ?? signRoot(tree.root, keys.privateKey);
    const merkleRoot = options?.rootOverride ?? tree.root;

    const batch = batchHashes.map((hash, i) => ({ id: `chain-${i}`, hash }));

    mockFindFirst.mockResolvedValue({
      id: `chain-${leafIndex}`,
      recordId: `record-${leafIndex}`,
      recordType: "JOURNAL_ENTRY",
      hash: batchHashes[leafIndex],
      previousHash: leafIndex === 0 ? null : batchHashes[leafIndex - 1],
      checkpointId: "checkpoint-1",
      createdAt: new Date(),
    });
    mockFindUnique.mockResolvedValue({
      id: "checkpoint-1",
      merkleRoot,
      signature,
      rangeStart: new Date("2026-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-01-02T00:00:00.000Z"),
      createdAt: new Date("2026-01-02T00:00:01.000Z"),
    });
    mockFindMany.mockResolvedValue(batch);

    return { tree };
  }

  beforeEach(() => {
    installPublicKey(keys.publicKey);
  });

  it("returns verified for a single-leaf checkpoint batch", async () => {
    const hashes = [sha256Hex("leaf-0")];
    mockCheckpointedEntry(hashes, 0);
    const result = await verifyLedgerChainEntryById(`chain-0`, ORG_ID);
    expect(result?.verdict).toBe("verified");
  });

  it.each([3, 5, 8])("returns verified for every leaf position in a %i-leaf checkpoint batch", async (size) => {
    const hashes = Array.from({ length: size }, (_, i) => sha256Hex(`leaf-${i}`));
    for (let leafIndex = 0; leafIndex < size; leafIndex++) {
      mockCheckpointedEntry(hashes, leafIndex);
      const result = await verifyLedgerChainEntryById(`chain-${leafIndex}`, ORG_ID);
      expect(result?.verdict).toBe("verified");
    }
  });

  it("reports the correct leafIndex and totalLeaves for a batch", async () => {
    const hashes = Array.from({ length: 6 }, (_, i) => sha256Hex(`leaf-${i}`));
    mockCheckpointedEntry(hashes, 4);
    const result = await verifyLedgerChainEntryById("chain-4", ORG_ID);
    expect(result).toMatchObject({ leafIndex: 4 });
    if (result && result.verdict !== "pending") {
      expect(result.checkpoint.totalLeaves).toBe(6);
    }
  });

  it("keeps the inclusion proof logarithmic in batch size", async () => {
    const hashes = Array.from({ length: 1024 }, (_, i) => sha256Hex(`leaf-${i}`));
    mockCheckpointedEntry(hashes, 500);
    const result = await verifyLedgerChainEntryById("chain-500", ORG_ID);
    if (result && result.verdict !== "pending") {
      expect(result.proof.length).toBeLessThanOrEqual(10); // ceil(log2(1024)) = 10
    }
  });

  it("returns failed when the checkpoint signature does not validate against the public key", async () => {
    const hashes = Array.from({ length: 4 }, (_, i) => sha256Hex(`leaf-${i}`));
    const otherKeys = generateSigningKeyPair();
    mockCheckpointedEntry(hashes, 1, { signatureOverride: signRoot(buildMerkleTree(hashes).root, otherKeys.privateKey) });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.signatureValid).toBe(false);
    }
  });

  it("returns failed when the checkpoint's merkleRoot has been tampered with", async () => {
    const hashes = Array.from({ length: 4 }, (_, i) => sha256Hex(`leaf-${i}`));
    mockCheckpointedEntry(hashes, 1, { rootOverride: sha256Hex("forged-root") });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
  });

  it("returns failed when the chain entry's own stored hash does not match what is in its checkpoint batch", async () => {
    const hashes = Array.from({ length: 4 }, (_, i) => sha256Hex(`leaf-${i}`));
    mockCheckpointedEntry(hashes, 1);
    // Simulate a stored hash that was altered after the checkpoint was made,
    // while everything else about the batch stays as originally checkpointed.
    mockFindFirst.mockResolvedValue({
      id: "chain-1",
      recordId: "record-1",
      recordType: "JOURNAL_ENTRY",
      hash: sha256Hex("tampered-hash"),
      previousHash: hashes[0],
      checkpointId: "checkpoint-1",
      createdAt: new Date(),
    });
    const result = await verifyLedgerChainEntryById("chain-1", ORG_ID);
    expect(result?.verdict).toBe("failed");
    if (result && result.verdict !== "pending") {
      expect(result.inclusionValid).toBe(false);
    }
  });

  it("includes checkpoint rangeStart/rangeEnd/id in a verified result", async () => {
    const hashes = [sha256Hex("only-leaf")];
    mockCheckpointedEntry(hashes, 0);
    const result = await verifyLedgerChainEntryById("chain-0", ORG_ID);
    if (result && result.verdict !== "pending") {
      expect(result.checkpoint.id).toBe("checkpoint-1");
      expect(result.checkpoint.rangeStart).toBeInstanceOf(Date);
      expect(result.checkpoint.rangeEnd).toBeInstanceOf(Date);
    } else {
      throw new Error("expected a non-pending result");
    }
  });
});
