import { computeChainAuthTag, verifyChainAuthTag } from "@secureledger/crypto";
import type { ChainAuthFields } from "@secureledger/crypto";

const MIN_KEY_LENGTH = 32;

/**
 * The secret behind each chain row's authentication tag (LEDGER_AUTH_KEY).
 * It is shared by the web application, which writes rows, and the checkpoint
 * worker, which checks them before signing. It must never be given to the
 * database or to anyone who only has database access: that separation is what
 * makes a forged row detectable.
 *
 * Production refuses to run without it. Outside production an unset key means
 * rows are written untagged, so local development and tests work unchanged.
 */
export function getLedgerAuthKey(): string | null {
  const key = process.env.LEDGER_AUTH_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LEDGER_AUTH_KEY is required in production");
    }
    return null;
  }
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(`LEDGER_AUTH_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  }
  return key;
}

/** The tag to store on a new chain row, or null when no key is configured. */
export function signChainRow(fields: ChainAuthFields): string | null {
  const key = getLedgerAuthKey();
  return key ? computeChainAuthTag(key, fields) : null;
}

/**
 * When tagging was switched on for this deployment (LEDGER_AUTH_START, an ISO
 * date). Rows created before it were written without a tag and are accepted
 * untagged. Unset means no legacy rows exist and every row must be tagged,
 * which is right for a fresh deployment.
 *
 * It comes from the environment, not the database, on purpose: anything stored
 * in the database can be rewritten by the attacker this exists to catch. If the
 * cut-off were inferred from the data ("no earlier row is tagged"), stripping
 * every tag would make a whole ledger look like it predates tagging.
 */
export function getLedgerAuthStart(): Date | null {
  const raw = process.env.LEDGER_AUTH_START;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("LEDGER_AUTH_START must be an ISO date, for example 2026-10-19T00:00:00Z");
  return date;
}

export type ChainRowAuthStatus =
  /** Tag present and correct. */
  | "authentic"
  /** No tag, but created before LEDGER_AUTH_START. */
  | "legacy"
  /** No tag on a row created after tagging began: something wrote it without the key. */
  | "missing"
  /** Tag present but wrong: forged, renumbered, moved or altered. */
  | "invalid"
  /** No key is configured here, so the row cannot be checked. */
  | "unchecked";

/** Judges one chain row against the key and the legacy cut-off. */
export function judgeChainRow(row: ChainAuthFields & { authTag: string | null; createdAt: Date }): ChainRowAuthStatus {
  const key = getLedgerAuthKey();
  if (!key) return "unchecked";
  if (row.authTag === null) {
    const start = getLedgerAuthStart();
    return start !== null && row.createdAt < start ? "legacy" : "missing";
  }
  return verifyChainAuthTag(key, row, row.authTag) ? "authentic" : "invalid";
}
