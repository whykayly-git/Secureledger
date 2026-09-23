import { randomBytes } from "crypto";

/**
 * A one-time, admin-visible temporary password for a newly invited staff
 * member. Never persisted in plaintext — only its bcrypt hash is stored
 * (via hashPassword, same as any other password in this app) — and, like
 * the password-reset flow's reset link, is only ever returned in the
 * single API response that creates the account, for the UI to show once
 * in a "copy this and share it securely" panel.
 */
export function generateTemporaryPassword(): string {
  // 4 groups of 4 base32-ish characters (no ambiguous 0/O/1/I), easy to
  // read aloud or retype if shared verbally, still >= 16 characters of
  // real entropy.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i !== 15) out += "-";
  }
  return out;
}
