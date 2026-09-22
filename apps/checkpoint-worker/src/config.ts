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

export const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  privateKeyPem: decodePrivateKey(requireEnv("CHECKPOINT_PRIVATE_KEY")),
  // How often the worker wakes up to check whether a checkpoint is due.
  pollIntervalMs: Number(process.env.CHECKPOINT_POLL_INTERVAL_MS ?? 60_000),
  // Force a checkpoint if this much time has passed since the last one for an org.
  maxIntervalMs: Number(process.env.CHECKPOINT_MAX_INTERVAL_MS ?? 60 * 60 * 1000),
  // Force a checkpoint as soon as this many uncommitted rows accumulate for an org.
  batchThreshold: Number(process.env.CHECKPOINT_BATCH_THRESHOLD ?? 500),
  healthPort: Number(process.env.HEALTH_PORT ?? 8081),
};
