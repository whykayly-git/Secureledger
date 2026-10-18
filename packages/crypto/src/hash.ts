import { createHash, createHmac, timingSafeEqual } from "crypto";
import { canonicalize } from "./canonical";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Computes the hash for a new LedgerChain entry. Runs synchronously and
 * inline inside the same DB transaction as the accounting write itself,
 * so it must stay O(1) — no Merkle work happens here.
 *
 * hash = SHA256(previousHash + ":" + canonicalSerialization(fields))
 */
export function computeChainHash(
  fields: Record<string, unknown>,
  previousHash: string | null
): string {
  const canonical = canonicalize(fields);
  const input = `${previousHash ?? "GENESIS"}:${canonical}`;
  return sha256Hex(input);
}

export type ChainAuthFields = {
  organisationId: string;
  recordType: string;
  recordId: string;
  sequenceNumber: number;
  hash: string;
};

/**
 * Keyed tag over a chain row: HMAC-SHA256 of its position and hash.
 *
 * The chain hash itself is unkeyed, so anyone who can write to the database
 * can compute a valid hash for a forged row. This tag can only be computed by
 * a holder of the secret key, which lives in the application and the checkpoint
 * worker and never in the database. Binding the organisation, record and
 * sequence number stops a row being moved or renumbered; binding the hash
 * covers every hashed field, because the hash already commits to them.
 */
export function computeChainAuthTag(key: string, fields: ChainAuthFields): string {
  const message = [fields.organisationId, fields.recordType, fields.recordId, fields.sequenceNumber, fields.hash].join(":");
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

/** Constant-time comparison of a stored tag against the one the key produces. */
export function verifyChainAuthTag(key: string, fields: ChainAuthFields, tag: string): boolean {
  const expected = Buffer.from(computeChainAuthTag(key, fields), "utf8");
  const actual = Buffer.from(tag, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
