import { prisma } from "@secureledger/db";
import { sha256Hex, generateSigningKeyPair, signRoot } from "@secureledger/crypto";
import { verifyLedgerChainEntryById } from "@secureledger/verification";
import {
  createTestOrganisation,
  postJournalEntry,
  runCheckpoint,
  teardownOrganisation,
} from "./harness";

export type Verdict = "verified" | "failed" | "pending";

export type ScenarioResult = {
  id: string;
  name: string;
  tamperDescription: string;
  expectedVerdict: Verdict;
  actualVerdict: string;
  pass: boolean;
  detail: string;
};

function buildResult(params: {
  id: string;
  name: string;
  tamperDescription: string;
  expectedVerdict: Verdict;
  actualVerdict: string | undefined | null;
  passMessage: string;
  failMessage: string;
}): ScenarioResult {
  const actualVerdict = params.actualVerdict ?? "ERROR(no result)";
  const pass = actualVerdict === params.expectedVerdict;
  return {
    id: params.id,
    name: params.name,
    tamperDescription: params.tamperDescription,
    expectedVerdict: params.expectedVerdict,
    actualVerdict,
    pass,
    detail: pass ? params.passMessage : params.failMessage,
  };
}

/**
 * Scenario 1 — Altered transaction amount.
 *
 * Directly UPDATEs a posted JournalEntry's line amount after it has been
 * hash-chained and checkpointed, WITHOUT touching the stored LedgerChain
 * hash (an attacker with raw DB access has no reason to know the hashing
 * scheme, let alone recompute it correctly). Expects verification to
 * detect that the record no longer matches what was chained.
 */
async function scenario1_alteredAmount(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s1-altered-amount");
  try {
    const { entry, chainEntry } = await postJournalEntry(ctx, "Office supplies purchase", 100);
    await runCheckpoint();

    const debitLine = entry.lines.find((l) => Number(l.debit) > 0)!;
    await prisma.journalLine.update({
      where: { id: debitLine.id },
      data: { debit: 999.99 },
    });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "1",
      name: "Altered transaction amount",
      tamperDescription: `JournalLine ${debitLine.id} debit changed from 100.00 to 999.99 directly via Prisma (LedgerChain.hash left untouched)`,
      expectedVerdict: "failed",
      actualVerdict: result?.verdict,
      passMessage:
        "Verification correctly reported FAILED — recomputing the record's hash from its current field values no longer matched the stored chain hash.",
      failMessage:
        'Verification did NOT detect the tampering (reported "' +
        (result?.verdict ?? "?") +
        '" instead of "failed"). Root cause: verifyLedgerChainEntryById never recomputes computeChainHash(fields, previousHash) from the JournalEntry/Invoice\'s CURRENT state — it only checks that the value already stored in LedgerChain.hash is included in a validly-signed Merkle checkpoint. A stored hash that is stale relative to the row it describes is never caught.',
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 2 — Altered stored hash.
 *
 * Directly UPDATEs the LedgerChain row's `hash` to an arbitrary
 * valid-looking SHA-256 string, leaving the JournalEntry itself untouched.
 * Expects verification to detect that the (now-wrong) stored hash no
 * longer sits under the checkpoint's signed Merkle root.
 */
async function scenario2_alteredStoredHash(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s2-altered-hash");
  try {
    const { chainEntry } = await postJournalEntry(ctx, "Consulting revenue reversal", 250);
    await runCheckpoint();

    const forgedHash = sha256Hex(`forged-hash-${Date.now()}-${Math.random()}`);
    await prisma.ledgerChain.update({
      where: { id: chainEntry.id },
      data: { hash: forgedHash },
    });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "2",
      name: "Altered stored hash",
      tamperDescription: `LedgerChain ${chainEntry.id} hash overwritten with an arbitrary SHA-256 string (${forgedHash.slice(0, 16)}…), JournalEntry left untouched`,
      expectedVerdict: "failed",
      actualVerdict: result?.verdict,
      passMessage:
        "Verification correctly reported FAILED — the forged hash no longer reconstructs to the checkpoint's original signed Merkle root.",
      failMessage:
        `Verification did NOT detect the tampering (reported "${result?.verdict ?? "?"}" instead of "failed").`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 3 — Altered previousHash pointer.
 *
 * Posts TWO entries so the second one has a real predecessor, then
 * directly UPDATEs the second LedgerChain row's `previousHash` to a
 * forged value — breaking chain continuity — while leaving that row's own
 * `hash` and the underlying JournalEntry completely untouched. This
 * isolates whether chain-LINK continuity is actually re-verified, as
 * opposed to only checking that a record's own hash was included in some
 * checkpoint.
 */
async function scenario3_alteredPreviousHash(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s3-altered-prevhash");
  try {
    await postJournalEntry(ctx, "Opening balance entry", 500);
    const second = await postJournalEntry(ctx, "Second entry in the chain", 75);
    await runCheckpoint();

    const forgedPreviousHash = sha256Hex(`forged-predecessor-${Date.now()}-${Math.random()}`);
    await prisma.ledgerChain.update({
      where: { id: second.chainEntry.id },
      data: { previousHash: forgedPreviousHash },
    });

    const result = await verifyLedgerChainEntryById(second.chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "3",
      name: "Altered previousHash pointer",
      tamperDescription: `LedgerChain ${second.chainEntry.id}.previousHash rewritten to a forged predecessor hash instead of entry 1's real hash — that row's own hash and record are untouched, isolating the chain-continuity check`,
      expectedVerdict: "failed",
      actualVerdict: result?.verdict,
      passMessage:
        "Verification correctly reported FAILED — chain-link continuity (previousHash) is re-verified independently of Merkle inclusion.",
      failMessage:
        `Verification did NOT detect the broken chain link (reported "${result?.verdict ?? "?"}" instead of "failed"). Root cause: verifyLedgerChainEntryById never re-derives or checks previousHash at all — it only performs Merkle-inclusion and signature checks on the row's own (untouched) hash field, so a forged previousHash that breaks the chain's link to its predecessor goes completely unnoticed.`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 4 — Tampered Merkle root.
 *
 * Directly UPDATEs a LedgerCheckpoint's `merkleRoot` to a different
 * valid-looking hash. Expects verification to detect that the ECDSA
 * signature (computed over the ORIGINAL root) no longer matches, and/or
 * that the freshly rebuilt Merkle tree no longer matches the altered
 * root.
 */
async function scenario4_tamperedMerkleRoot(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s4-tampered-root");
  try {
    const { chainEntry } = await postJournalEntry(ctx, "Equipment purchase", 1200);
    await runCheckpoint();

    const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({
      where: { organisationId: ctx.organisationId },
    });
    const forgedRoot = sha256Hex(`forged-root-${Date.now()}-${Math.random()}`);
    await prisma.ledgerCheckpoint.update({
      where: { id: checkpoint.id },
      data: { merkleRoot: forgedRoot },
    });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "4",
      name: "Tampered Merkle root",
      tamperDescription: `LedgerCheckpoint ${checkpoint.id}.merkleRoot overwritten with an arbitrary hash (${forgedRoot.slice(0, 16)}…)`,
      expectedVerdict: "failed",
      actualVerdict: result?.verdict,
      passMessage:
        "Verification correctly reported FAILED — the ECDSA signature (over the original root) no longer matches the altered root, and the rebuilt inclusion proof no longer resolves to it either.",
      failMessage:
        `Verification did NOT detect the tampering (reported "${result?.verdict ?? "?"}" instead of "failed").`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 5 — Forged signature.
 *
 * Directly UPDATEs a LedgerCheckpoint's `signature` to a plausible-looking
 * but incorrect value (a real ECDSA signature — just from the WRONG key),
 * leaving `merkleRoot` untouched. Expects verification to detect the
 * signature no longer validates against the checkpoint-worker's public
 * key.
 */
async function scenario5_forgedSignature(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s5-forged-signature");
  try {
    const { chainEntry } = await postJournalEntry(ctx, "Loan repayment", 300);
    await runCheckpoint();

    const checkpoint = await prisma.ledgerCheckpoint.findFirstOrThrow({
      where: { organisationId: ctx.organisationId },
    });

    // A real, validly-formed ECDSA signature over the SAME root — just
    // signed with a different (attacker-controlled) private key, exactly
    // what an attacker without the real key would have to fall back to.
    const impostorKeys = generateSigningKeyPair();
    const forgedSignature = signRoot(checkpoint.merkleRoot, impostorKeys.privateKey);
    await prisma.ledgerCheckpoint.update({
      where: { id: checkpoint.id },
      data: { signature: forgedSignature },
    });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "5",
      name: "Forged signature",
      tamperDescription: `LedgerCheckpoint ${checkpoint.id}.signature replaced with a validly-formed ECDSA signature produced by a DIFFERENT key pair (merkleRoot left untouched)`,
      expectedVerdict: "failed",
      actualVerdict: result?.verdict,
      passMessage:
        "Verification correctly reported FAILED — the forged signature does not validate against the checkpoint-worker's real public key.",
      failMessage:
        `Verification did NOT detect the forged signature (reported "${result?.verdict ?? "?"}" instead of "failed").`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 6 — Tampering with a record still pending checkpoint.
 *
 * Posts an entry and deliberately does NOT run a checkpoint cycle, then
 * tampers with it anyway. Expects an honest "pending" verdict — distinct
 * from both "verified" and "failed" — because there is no signed
 * checkpoint yet to cryptographically confirm anything against. A system
 * that fell back to "verified" here (nothing to compare against yet) would
 * be a dangerous false pass; this scenario proves that doesn't happen.
 */
async function scenario6_pendingRecordTampered(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s6-pending-tampered");
  try {
    const { entry, chainEntry } = await postJournalEntry(ctx, "Not yet checkpointed entry", 60);
    // Deliberately skip runCheckpoint() — this record must stay pending.

    const debitLine = entry.lines.find((l) => Number(l.debit) > 0)!;
    await prisma.journalLine.update({
      where: { id: debitLine.id },
      data: { debit: 123456 },
    });

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "6",
      name: "Tampering with a record still pending checkpoint",
      tamperDescription: `JournalLine ${debitLine.id} debit changed from 60 to 123456 on a record with no LedgerCheckpoint yet (checkpointId is still null)`,
      expectedVerdict: "pending",
      actualVerdict: result?.verdict,
      passMessage:
        'Verification correctly reported "pending" — it honestly declines to confirm a record that has not yet been checkpointed, rather than falsely reporting "verified" just because there is nothing to compare against.',
      failMessage:
        `Verification returned "${result?.verdict ?? "?"}" instead of the honest "pending" state for an uncheckpointed record.`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario 7 — Control case (no tampering).
 *
 * Proves the previous scenarios' FAIL/pending verdicts are meaningful —
 * i.e. this suite is capable of returning "verified" at all, not a suite
 * that always reports failure regardless of input.
 */
async function scenario7_controlUntouched(): Promise<ScenarioResult> {
  const ctx = await createTestOrganisation("s7-control");
  try {
    const { chainEntry } = await postJournalEntry(ctx, "Untouched control entry", 42);
    await runCheckpoint();

    const result = await verifyLedgerChainEntryById(chainEntry.id, ctx.organisationId);

    return buildResult({
      id: "7",
      name: "Control — untouched, correctly checkpointed record",
      tamperDescription: "(none — control case)",
      expectedVerdict: "verified",
      actualVerdict: result?.verdict,
      passMessage: "Verification correctly reported VERIFIED for an untampered, checkpointed record.",
      failMessage:
        `An untampered record was NOT reported as verified (reported "${result?.verdict ?? "?"}"). This indicates a problem in the suite's own seeding/checkpoint harness, not the tamper scenarios.`,
    });
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

export type ScenarioDescriptor = {
  id: string;
  label: string;
  run: () => Promise<ScenarioResult>;
};

export const SCENARIOS: ScenarioDescriptor[] = [
  { id: "1", label: "Altered transaction amount", run: scenario1_alteredAmount },
  { id: "2", label: "Altered stored hash", run: scenario2_alteredStoredHash },
  { id: "3", label: "Altered previousHash pointer", run: scenario3_alteredPreviousHash },
  { id: "4", label: "Tampered Merkle root", run: scenario4_tamperedMerkleRoot },
  { id: "5", label: "Forged signature", run: scenario5_forgedSignature },
  { id: "6", label: "Tampering with a pending (non-checkpointed) record", run: scenario6_pendingRecordTampered },
  { id: "7", label: "Control — untouched record", run: scenario7_controlUntouched },
];
