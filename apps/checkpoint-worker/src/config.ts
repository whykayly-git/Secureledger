import { createPublicKey } from "crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function decodePrivateKey(raw: string): string {
  // Accept either a raw PEM (with literal newlines) or a base64-encoded PEM,
  // since most container/secret-manager setups can't carry multiline env vars cleanly.
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}

const privateKeyPem = decodePrivateKey(requireEnv("CHECKPOINT_PRIVATE_KEY"));

// The scheduled verifier reads the PUBLIC key from CHECKPOINT_PUBLIC_KEY, exactly
// as the web application does. If it is not set for this process, derive it
// from the signing key so the two can never disagree.
if (!process.env.CHECKPOINT_PUBLIC_KEY) {
  process.env.CHECKPOINT_PUBLIC_KEY = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
}

export const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  privateKeyPem,
  // How often the worker wakes up to check whether a checkpoint is due.
  pollIntervalMs: Number(process.env.CHECKPOINT_POLL_INTERVAL_MS ?? 60_000),
  // Force a checkpoint if this much time has passed since the last one for an org.
  maxIntervalMs: Number(process.env.CHECKPOINT_MAX_INTERVAL_MS ?? 60 * 60 * 1000),
  // Force a checkpoint as soon as this many uncommitted rows accumulate for an org.
  batchThreshold: Number(process.env.CHECKPOINT_BATCH_THRESHOLD ?? 500),
  healthPort: Number(process.env.HEALTH_PORT ?? 8081),
  // How often each organisation is fully verified (Verify all). 0 turns it off.
  verificationIntervalMs: Number(process.env.VERIFICATION_INTERVAL_MS ?? 60 * 60 * 1000),
  // Most chain rows one scheduled verification checks per organisation.
  verificationMaxRecords: Number(process.env.VERIFICATION_MAX_RECORDS ?? 5000),
};
