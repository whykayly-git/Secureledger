import { sha256Hex } from "./hash";

export type ProofStep = {
  hash: string;
  position: "left" | "right";
};

export type MerkleTree = {
  root: string;
  layers: string[][];
};

function hashPair(left: string, right: string): string {
  return sha256Hex(left + right);
}

/**
 * Builds a Merkle tree over an ordered list of leaf hashes. Odd nodes at
 * any level are paired with a duplicate of themselves (standard
 * Bitcoin-style padding) so every level halves cleanly.
 */
export function buildMerkleTree(leafHashes: string[]): MerkleTree {
  if (leafHashes.length === 0) {
    throw new Error("Cannot build a Merkle tree from zero leaves");
  }

  const layers: string[][] = [leafHashes.slice()];
  let current = leafHashes.slice();

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(hashPair(left, right));
    }
    layers.push(next);
    current = next;
  }

  return { root: current[0], layers };
}

/**
 * Builds the logarithmic-size inclusion proof for the leaf at `leafIndex`.
 * Walking this proof against the leaf hash recomputes the root without
 * needing the full set of leaves.
 */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): ProofStep[] {
  const { layers } = tree;
  if (leafIndex < 0 || leafIndex >= layers[0].length) {
    throw new Error("leafIndex out of range");
  }

  const proof: ProofStep[] = [];
  let index = leafIndex;

  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const isRightNode = index % 2 === 1;
    const pairIndex = isRightNode ? index - 1 : index + 1;
    const siblingHash = pairIndex < layer.length ? layer[pairIndex] : layer[index];
    proof.push({ hash: siblingHash, position: isRightNode ? "left" : "right" });
    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Recomputes the root from a leaf hash and its proof path, and compares
 * it to the expected root. Used by the read-only verification endpoint —
 * no access to the full leaf set is required.
 */
export function verifyMerkleProof(leafHash: string, proof: ProofStep[], expectedRoot: string): boolean {
  let computed = leafHash;
  for (const step of proof) {
    computed = step.position === "left" ? hashPair(step.hash, computed) : hashPair(computed, step.hash);
  }
  return computed === expectedRoot;
}
