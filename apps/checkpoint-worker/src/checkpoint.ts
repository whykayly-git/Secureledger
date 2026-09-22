import { buildMerkleTree, signRoot } from "@secureledger/crypto";

export type PendingChainRow = {
  id: string;
  hash: string;
  createdAt: Date;
};

export type CheckpointPayload = {
  merkleRoot: string;
  signature: string;
  rangeStart: Date;
  rangeEnd: Date;
  includedChainIds: string[];
  recordsProcessed: number;
};

/**
 * Pure function: given a batch of pending LedgerChain rows for one
 * organisation and the worker's private key, builds the Merkle tree,
 * signs the root, and returns everything needed to persist a
 * LedgerCheckpoint — without touching the database. Kept separate from
 * the DB orchestration below so it can be unit tested directly.
 */
export function buildCheckpointPayload(
  rows: PendingChainRow[],
  privateKeyPem: string
): CheckpointPayload {
  if (rows.length === 0) {
    throw new Error("Cannot checkpoint an empty batch");
  }

  // Deterministic ordering: oldest first, so proofs are stable and the
  // Merkle leaf order matches the order records entered the chain.
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const leafHashes = ordered.map((r) => r.hash);
  const tree = buildMerkleTree(leafHashes);
  const signature = signRoot(tree.root, privateKeyPem);

  return {
    merkleRoot: tree.root,
    signature,
    rangeStart: ordered[0].createdAt,
    rangeEnd: ordered[ordered.length - 1].createdAt,
    includedChainIds: ordered.map((r) => r.id),
    recordsProcessed: ordered.length,
  };
}

export type CheckpointDecision = {
  shouldCheckpoint: boolean;
  reason: "threshold" | "interval" | "none";
};

/**
 * Decides whether an organisation is due for a checkpoint: either it has
 * accumulated at least `batchThreshold` uncommitted rows, or more than
 * `maxIntervalMs` has passed since its last checkpoint (both conditions
 * are checked every poll cycle).
 */
export function decideCheckpoint(params: {
  pendingCount: number;
  lastCheckpointAt: Date | null;
  now: Date;
  batchThreshold: number;
  maxIntervalMs: number;
}): CheckpointDecision {
  const { pendingCount, lastCheckpointAt, now, batchThreshold, maxIntervalMs } = params;

  if (pendingCount === 0) {
    return { shouldCheckpoint: false, reason: "none" };
  }
  if (pendingCount >= batchThreshold) {
    return { shouldCheckpoint: true, reason: "threshold" };
  }
  const elapsed = now.getTime() - (lastCheckpointAt?.getTime() ?? 0);
  if (lastCheckpointAt === null || elapsed >= maxIntervalMs) {
    return { shouldCheckpoint: true, reason: "interval" };
  }
  return { shouldCheckpoint: false, reason: "none" };
}
