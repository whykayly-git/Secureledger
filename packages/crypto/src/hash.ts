import { createHash } from "crypto";
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
