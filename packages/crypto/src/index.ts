export { canonicalize } from "./canonical";
export { sha256Hex, computeChainHash, computeChainAuthTag, verifyChainAuthTag } from "./hash";
export type { ChainAuthFields } from "./hash";
export { buildMerkleTree, getMerkleProof, verifyMerkleProof } from "./merkle";
export type { ProofStep, MerkleTree } from "./merkle";
export { generateSigningKeyPair, signRoot, verifyRootSignature } from "./sign";
export type { ECKeyPair } from "./sign";
