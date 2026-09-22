/**
 * The web app (and the security-test suite, which verifies through this
 * same code) only ever holds the ECDSA PUBLIC key, used to verify
 * checkpoint signatures. The matching private key lives exclusively in
 * the checkpoint-worker's environment and is never present here.
 */
function decodePublicKey(raw: string): string {
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}

export function getCheckpointPublicKey(): string {
  const raw = process.env.CHECKPOINT_PUBLIC_KEY;
  if (!raw) {
    throw new Error("Missing required environment variable: CHECKPOINT_PUBLIC_KEY");
  }
  return decodePublicKey(raw);
}
