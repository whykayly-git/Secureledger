import { prisma } from "@secureledger/db";
import {
  buildMerkleTree,
  computeChainHash,
  getMerkleProof,
  verifyMerkleProof,
  verifyRootSignature,
  ProofStep,
} from "@secureledger/crypto";
import { journalEntryHashFields, invoiceHashFields } from "@secureledger/ledger";
import { getCheckpointPublicKey } from "./publicKey";

export type FailureReason = "hash_mismatch" | "chain_link_broken" | "merkle_inclusion_invalid" | "signature_invalid";

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
      failureReason: FailureReason | null;
      leafIndex: number | null;
      proof: ProofStep[] | null;
      checkpoint: {
        id: string;
        merkleRoot: string;
        signature: string;
        rangeStart: Date;
        rangeEnd: Date;
        createdAt: Date;
        totalLeaves: number;
      } | null;
    };

/**
 * Recomputes a LedgerChain entry's hash from the CURRENT state of the
 * underlying JournalEntry/Invoice, using the exact same field-selection
 * functions the write path uses (packages/ledger), so verification can
 * never drift from what was actually hashed at write time.
 *
 * Both lookups are scoped by `organisationId`, not just `id` — a
 * LedgerChain row claiming to belong to Org A but pointing (via
 * `recordId`) at a real, unaltered record that actually belongs to Org B
 * would otherwise recompute successfully (the fields ARE real, just
 * cross-tenant) and pass every other check. Scoping by organisationId is
 * the same defense-in-depth pattern every other multi-tenant query in
 * this codebase already uses (e.g. every `apps/web` route's
 * `prisma.journalEntry.findFirst({ where: { id, organisationId } })`) —
 * not a weaker substitute for a database-level constraint, but the
 * correct fix given recordId is deliberately untyped (it polymorphically
 * refers to either a JournalEntry or an Invoice depending on recordType,
 * so it can't be a real foreign key without a larger schema change).
 *
 * Returns null if the underlying record no longer exists FOR THIS
 * ORGANISATION (e.g. a deleted draft, or a cross-tenant reference) —
 * treated by the caller as a hash mismatch, since there is no longer any
 * real, same-tenant data the stored hash could be validated against.
 */
async function recomputeStoredHash(
  recordType: string,
  recordId: string,
  organisationId: string,
  previousHash: string | null
): Promise<string | null> {
  if (recordType === "JOURNAL_ENTRY") {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: recordId, organisationId },
      include: { lines: true },
    });
    if (!entry) return null;
    return computeChainHash(journalEntryHashFields(entry), previousHash);
  }

  if (recordType === "INVOICE") {
    const invoice = await prisma.invoice.findFirst({ where: { id: recordId, organisationId } });
    if (!invoice) return null;
    return computeChainHash(invoiceHashFields(invoice), previousHash);
  }

  return null;
}

/**
 * Confirms this chain entry's stored `previousHash` actually equals the
 * hash of the row that immediately precedes it in this organisation's
 * chain — the same "most recent row so far" ordering the write path uses
 * to determine the tip at write time (packages/ledger/src/hashChain.ts).
 * Because writes are serialized per-organisation by the advisory lock,
 * createdAt ordering faithfully reflects the real chain sequence, so the
 * immediately-preceding row is unambiguous.
 */
async function isChainLinkIntact(chainEntry: {
  organisationId: string;
  createdAt: Date;
  previousHash: string | null;
}): Promise<boolean> {
  const priorRow = await prisma.ledgerChain.findFirst({
    where: { organisationId: chainEntry.organisationId, createdAt: { lt: chainEntry.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });

  if (!priorRow) {
    // No predecessor exists — only valid if this row claims to be genesis.
    return chainEntry.previousHash === null;
  }
  return chainEntry.previousHash === priorRow.hash;
}

/**
 * Verifies a single LedgerChain entry: recomputes its hash from the
 * CURRENT underlying record data, confirms its previousHash link to the
 * actual prior chain row, and — once checkpointed — rebuilds the Merkle
 * inclusion proof from only the rows in that checkpoint's batch (never
 * the whole chain) and checks the ECDSA signature with the public key
 * only.
 *
 * The hash-recompute and chain-link checks run for every verdict path,
 * including "pending" — a record that has been tampered with is reported
 * as "failed" whether or not it has been checkpointed yet, since those
 * two checks need no checkpoint to evaluate.
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

  const failed = (failureReason: FailureReason): VerificationResult => ({
    verdict: "failed",
    chainId: chainEntry.id,
    recordId: chainEntry.recordId,
    recordType: chainEntry.recordType,
    hash: chainEntry.hash,
    previousHash: chainEntry.previousHash,
    createdAt: chainEntry.createdAt,
    inclusionValid: false,
    signatureValid: false,
    failureReason,
    leafIndex: null,
    proof: null,
    checkpoint: null,
  });

  // --- Checks that need no checkpoint, and so apply on every path ---

  const recomputedHash = await recomputeStoredHash(
    chainEntry.recordType,
    chainEntry.recordId,
    chainEntry.organisationId,
    chainEntry.previousHash
  );
  if (recomputedHash === null || recomputedHash !== chainEntry.hash) {
    return failed("hash_mismatch");
  }

  const chainLinkIntact = await isChainLinkIntact(chainEntry);
  if (!chainLinkIntact) {
    return failed("chain_link_broken");
  }

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

  // --- Checkpoint-dependent checks: only reached once the record is
  //     confirmed internally consistent with its own recorded data ---

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

  const failureReason: FailureReason | null = !inclusionValid
    ? "merkle_inclusion_invalid"
    : !signatureValid
      ? "signature_invalid"
      : null;

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
    failureReason,
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
