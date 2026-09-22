import { generateSigningKeyPair, verifyRootSignature, verifyMerkleProof, buildMerkleTree, getMerkleProof } from "@secureledger/crypto";
import { buildCheckpointPayload, decideCheckpoint, PendingChainRow } from "../src/checkpoint";

const { publicKey, privateKey } = generateSigningKeyPair();

function row(id: string, hash: string, createdAt: string): PendingChainRow {
  return { id, hash, createdAt: new Date(createdAt) };
}

describe("buildCheckpointPayload", () => {
  it("throws on an empty batch", () => {
    expect(() => buildCheckpointPayload([], privateKey)).toThrow();
  });

  it("produces a signature that verifies against the public key", () => {
    const rows = [
      row("1", "a".repeat(64), "2024-01-01T00:00:00Z"),
      row("2", "b".repeat(64), "2024-01-01T00:01:00Z"),
      row("3", "c".repeat(64), "2024-01-01T00:02:00Z"),
    ];
    const payload = buildCheckpointPayload(rows, privateKey);
    expect(verifyRootSignature(payload.merkleRoot, payload.signature, publicKey)).toBe(true);
  });

  it("orders rows by createdAt regardless of input order, so the leaf order is deterministic", () => {
    const rows = [
      row("2", "b".repeat(64), "2024-01-01T00:01:00Z"),
      row("1", "a".repeat(64), "2024-01-01T00:00:00Z"),
      row("3", "c".repeat(64), "2024-01-01T00:02:00Z"),
    ];
    const shuffled = buildCheckpointPayload(rows, privateKey);
    const sorted = buildCheckpointPayload([rows[1], rows[0], rows[2]], privateKey);
    expect(shuffled.merkleRoot).toBe(sorted.merkleRoot);
    expect(shuffled.includedChainIds).toEqual(["1", "2", "3"]);
  });

  it("sets rangeStart/rangeEnd from the oldest and newest rows", () => {
    const rows = [
      row("1", "a".repeat(64), "2024-01-01T00:00:00Z"),
      row("2", "b".repeat(64), "2024-01-03T00:00:00Z"),
      row("3", "c".repeat(64), "2024-01-02T00:00:00Z"),
    ];
    const payload = buildCheckpointPayload(rows, privateKey);
    expect(payload.rangeStart.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(payload.rangeEnd.toISOString()).toBe("2024-01-03T00:00:00.000Z");
  });

  it("produces a root whose leaves are independently provable with getMerkleProof", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(String(i), require("crypto").createHash("sha256").update(`h${i}`).digest("hex"), `2024-01-01T00:0${i}:00Z`)
    );
    const payload = buildCheckpointPayload(rows, privateKey);

    // Rebuild the tree directly from createdAt-sorted rows, the same way buildCheckpointPayload does.
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const directTree = buildMerkleTree(ordered.map((r) => r.hash));
    expect(payload.merkleRoot).toBe(directTree.root);

    const proof = getMerkleProof(directTree, 3);
    expect(verifyMerkleProof(ordered[3].hash, proof, payload.merkleRoot)).toBe(true);
  });
});

describe("decideCheckpoint", () => {
  const now = new Date("2024-01-01T12:00:00Z");

  it("does not checkpoint when there are no pending rows", () => {
    const decision = decideCheckpoint({
      pendingCount: 0,
      lastCheckpointAt: null,
      now,
      batchThreshold: 500,
      maxIntervalMs: 3600_000,
    });
    expect(decision.shouldCheckpoint).toBe(false);
  });

  it("checkpoints immediately on first-ever pending rows (no prior checkpoint)", () => {
    const decision = decideCheckpoint({
      pendingCount: 1,
      lastCheckpointAt: null,
      now,
      batchThreshold: 500,
      maxIntervalMs: 3600_000,
    });
    expect(decision.shouldCheckpoint).toBe(true);
    expect(decision.reason).toBe("interval");
  });

  it("checkpoints when the batch threshold is reached, even if recently checkpointed", () => {
    const decision = decideCheckpoint({
      pendingCount: 500,
      lastCheckpointAt: new Date("2024-01-01T11:59:00Z"),
      now,
      batchThreshold: 500,
      maxIntervalMs: 3600_000,
    });
    expect(decision.shouldCheckpoint).toBe(true);
    expect(decision.reason).toBe("threshold");
  });

  it("checkpoints when the max interval has elapsed, even with few pending rows", () => {
    const decision = decideCheckpoint({
      pendingCount: 3,
      lastCheckpointAt: new Date("2024-01-01T10:00:00Z"),
      now,
      batchThreshold: 500,
      maxIntervalMs: 3600_000,
    });
    expect(decision.shouldCheckpoint).toBe(true);
    expect(decision.reason).toBe("interval");
  });

  it("does not checkpoint when neither condition is met", () => {
    const decision = decideCheckpoint({
      pendingCount: 3,
      lastCheckpointAt: new Date("2024-01-01T11:45:00Z"),
      now,
      batchThreshold: 500,
      maxIntervalMs: 3600_000,
    });
    expect(decision.shouldCheckpoint).toBe(false);
  });
});
