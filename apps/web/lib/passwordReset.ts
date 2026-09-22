import { randomBytes, createHash } from "crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** A raw, URL-safe token handed to the user once; only its hash is ever persisted. */
export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
