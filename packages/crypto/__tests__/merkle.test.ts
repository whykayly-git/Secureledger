import { sha256Hex } from "../src/hash";
import { buildMerkleTree, getMerkleProof, verifyMerkleProof } from "../src/merkle";

function leaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => sha256Hex(`leaf-${i}`));
}

describe("buildMerkleTree", () => {
  it("throws on an empty leaf set", () => {
    expect(() => buildMerkleTree([])).toThrow();
  });

  it("returns the leaf itself as the root for a single-leaf tree", () => {
    const [only] = leaves(1);
    const tree = buildMerkleTree([only]);
    expect(tree.root).toBe(only);
  });

  it("produces a stable root for a given leaf order", () => {
    const l = leaves(5);
    const t1 = buildMerkleTree(l);
    const t2 = buildMerkleTree(l.slice());
    expect(t1.root).toBe(t2.root);
  });

  it("produces a different root when leaf order changes", () => {
    const l = leaves(4);
    const t1 = buildMerkleTree(l);
    const reordered = [l[1], l[0], l[2], l[3]];
    const t2 = buildMerkleTree(reordered);
    expect(t1.root).not.toBe(t2.root);
  });

  it("produces a layers array with one level per tree height, leaves first and root last", () => {
    const tree = buildMerkleTree(leaves(8));
    // 8 leaves -> 8, 4, 2, 1 = 4 levels
    expect(tree.layers.length).toBe(4);
    expect(tree.layers[0].length).toBe(8);
    expect(tree.layers[tree.layers.length - 1]).toEqual([tree.root]);
  });

  it("handles duplicate leaf hashes without throwing, and stays deterministic", () => {
    const dup = sha256Hex("same-leaf");
    const t1 = buildMerkleTree([dup, dup, dup]);
    const t2 = buildMerkleTree([dup, dup, dup]);
    expect(t1.root).toBe(t2.root);
  });

  it("pads an odd node by duplicating it, rather than throwing", () => {
    expect(() => buildMerkleTree(leaves(3))).not.toThrow();
    expect(() => buildMerkleTree(leaves(5))).not.toThrow();
  });
});

describe("Merkle inclusion proofs", () => {
  it.each([1, 2, 3, 4, 5, 7, 8, 16, 17])(
    "verifies every leaf's inclusion proof for a tree of size %i",
    (size) => {
      const l = leaves(size);
      const tree = buildMerkleTree(l);
      for (let i = 0; i < size; i++) {
        const proof = getMerkleProof(tree, i);
        expect(verifyMerkleProof(l[i], proof, tree.root)).toBe(true);
      }
    }
  );

  it("rejects a proof for a tampered leaf hash", () => {
    const l = leaves(6);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 2);
    const tamperedLeaf = sha256Hex("not-the-real-leaf");
    expect(verifyMerkleProof(tamperedLeaf, proof, tree.root)).toBe(false);
  });

  it("rejects a proof checked against the wrong root", () => {
    const l = leaves(6);
    const tree = buildMerkleTree(l);
    const otherTree = buildMerkleTree(leaves(6).map((h) => sha256Hex(h)));
    const proof = getMerkleProof(tree, 0);
    expect(verifyMerkleProof(l[0], proof, otherTree.root)).toBe(false);
  });

  it("keeps proof size logarithmic in the number of leaves", () => {
    const size = 1024;
    const l = leaves(size);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 500);
    expect(proof.length).toBe(Math.ceil(Math.log2(size)));
  });

  it("throws for an out-of-range leaf index", () => {
    const tree = buildMerkleTree(leaves(4));
    expect(() => getMerkleProof(tree, 4)).toThrow();
    expect(() => getMerkleProof(tree, -1)).toThrow();
  });

  it("returns an empty proof for a single-leaf tree, and the leaf verifies against its own root", () => {
    const [only] = leaves(1);
    const tree = buildMerkleTree([only]);
    const proof = getMerkleProof(tree, 0);
    expect(proof).toEqual([]);
    expect(verifyMerkleProof(only, proof, tree.root)).toBe(true);
  });

  it("gives a 2-leaf tree's proofs the correct left/right sibling positions", () => {
    const l = leaves(2);
    const tree = buildMerkleTree(l);
    const proofForLeft = getMerkleProof(tree, 0);
    const proofForRight = getMerkleProof(tree, 1);
    expect(proofForLeft).toEqual([{ hash: l[1], position: "right" }]);
    expect(proofForRight).toEqual([{ hash: l[0], position: "left" }]);
  });

  it("rejects a proof whose sibling hash has been tampered with", () => {
    const l = leaves(6);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 3);
    const tamperedProof = proof.map((step, i) => (i === 0 ? { ...step, hash: sha256Hex("forged-sibling") } : step));
    expect(verifyMerkleProof(l[3], tamperedProof, tree.root)).toBe(false);
  });

  it("rejects a proof whose left/right position has been swapped", () => {
    const l = leaves(4);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 0);
    const swapped = proof.map((step) => ({ ...step, position: step.position === "left" ? ("right" as const) : ("left" as const) }));
    expect(verifyMerkleProof(l[0], swapped, tree.root)).toBe(false);
  });

  it("rejects a proof with an extra spurious step appended", () => {
    const l = leaves(4);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 0);
    const extended = [...proof, { hash: sha256Hex("spurious"), position: "right" as const }];
    expect(verifyMerkleProof(l[0], extended, tree.root)).toBe(false);
  });

  it("rejects a proof missing a required step", () => {
    const l = leaves(8);
    const tree = buildMerkleTree(l);
    const proof = getMerkleProof(tree, 5);
    expect(proof.length).toBeGreaterThan(1);
    const truncated = proof.slice(0, proof.length - 1);
    expect(verifyMerkleProof(l[5], truncated, tree.root)).toBe(false);
  });
});
