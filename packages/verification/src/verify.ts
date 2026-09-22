import { prisma } from "@secureledger/db";
import { buildMerkleTree, getMerkleProof, verifyMerkleProof, verifyRootSignature, ProofStep } from "@secureledger/crypto";
import { getCheckpointPublicKey } from "./publicKey";

export type VerificationResult =
  | {
      verdict: "pending";
      chainId: string;
      recordId: string;
      recordType: string;
      hash: string;
      previousHash: string | null;
      createdAt: Date;
    }
  | {
      verdict: "verified" | "failed";
      chainId: string;
      recordId: string;
      recordType: string;
      hash: string;
      previousHash: string | null;
      createdAt: Date;
      inclusionValid: boolean;
      signatureValid: boolean;
      leafIndex: number;
      proof: ProofStep[];
      checkpoint: {
        id: string;
        merkleRoot: string;
        signature: string;
        rangeStart: Date;
        rangeEnd: Date;
        createdAt: Date;
        totalLeaves: number;
      };
    };

/**
 * Verifies a single LedgerChain entry against its checkpoint: rebuilds the
 * Merkle inclusion proof from only the rows in that checkpoint's batch
 * (never the whole chain) and checks the ECDSA signature with the public
 * key only.
 *
 * This is the exact function both `/api/verify/[recordId]` (apps/web) and
 * the tamper-detection security-test suite (apps/security-tests) call —
 * a shared package rather than two copies, so tests exercise the real
 * verification path, not a reimplementation of it.
 */
export async function verifyLedgerChainEntryById(
  chainEntryId: string,
  organisationId: string
): Promise<VerificationResult | null> {
  const chainEntry = await prisma.ledgerChain.findFirst({
    where: { id: chainEntryId, organisationId },
  });
  if (!chainEntry) return null;

  if (!chainEntry.checkpointId) {
    return {
      verdict: "pending",
      chainId: chainEntry.id,
      recordId: chainEntry.recordId,
      recordType: chainEntry.recordType,
      hash: chainEntry.hash,
      previousHash: chainEntry.previousHash,
      createdAt: chainEntry.createdAt,
    };
  }

  const checkpoint = await prisma.ledgerCheckpoint.findUnique({ where: { id: chainEntry.checkpointId } });
  if (!checkpoint) {
    throw new Error(`Chain entry ${chainEntry.id} references a missing checkpoint`);
  }

  const batch = await prisma.ledgerChain.findMany({
    where: { checkpointId: checkpoint.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, hash: true },
  });
  const leafIndex = batch.findIndex((row) => row.id === chainEntry.id);
  if (leafIndex === -1) {
    throw new Error(`Chain entry ${chainEntry.id} not found in its own checkpoint batch`);
  }

  const tree = buildMerkleTree(batch.map((row) => row.hash));
  const proof = getMerkleProof(tree, leafIndex);
  const inclusionValid = verifyMerkleProof(chainEntry.hash, proof, checkpoint.merkleRoot);

  const publicKey = getCheckpointPublicKey();
  const signatureValid = verifyRootSignature(checkpoint.merkleRoot, checkpoint.signature, publicKey);

  return {
    verdict: inclusionValid && signatureValid ? "verified" : "failed",
    chainId: chainEntry.id,
    recordId: chainEntry.recordId,
    recordType: chainEntry.recordType,
    hash: chainEntry.hash,
    previousHash: chainEntry.previousHash,
    createdAt: chainEntry.createdAt,
    inclusionValid,
    signatureValid,
    leafIndex,
    proof,
    checkpoint: {
      id: checkpoint.id,
      merkleRoot: checkpoint.merkleRoot,
      signature: checkpoint.signature,
      rangeStart: checkpoint.rangeStart,
      rangeEnd: checkpoint.rangeEnd,
      createdAt: checkpoint.createdAt,
      totalLeaves: batch.length,
    },
  };
}
