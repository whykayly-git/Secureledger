import cron from "node-cron";
import { prisma } from "@secureledger/db";
import { getLedgerAuthKey } from "@secureledger/ledger";
import { config } from "./config";
import { runCheckpointCycle } from "./cycle";
import { runVerificationCycle } from "./verificationCycle";
import { startHealthServer, WorkerHealthState } from "./health";
import { logger } from "./logger";

const state: WorkerHealthState = {
  status: "starting",
  lastCycleAt: null,
  lastError: null,
};

let busy = false;

async function tick(): Promise<void> {
  // A verification of a large ledger can outlast one poll interval; never overlap two runs.
  if (busy) return;
  busy = true;
  try {
    await checkpointTick();
    await verificationTick();
  } finally {
    busy = false;
  }
}

async function verificationTick(): Promise<void> {
  try {
    await runVerificationCycle(prisma, {
      intervalMs: config.verificationIntervalMs,
      maxRecords: config.verificationMaxRecords,
    });
  } catch (err) {
    logger.error("Unhandled error during scheduled verification", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function checkpointTick(): Promise<void> {
  try {
    await runCheckpointCycle(prisma, {
      batchThreshold: config.batchThreshold,
      maxIntervalMs: config.maxIntervalMs,
      privateKeyPem: config.privateKeyPem,
    });
    state.status = "ok";
    state.lastCycleAt = new Date().toISOString();
    state.lastError = null;
  } catch (err) {
    state.status = "unhealthy";
    state.lastError = err instanceof Error ? err.message : String(err);
    logger.error("Unhandled error during checkpoint cycle", { error: state.lastError });
  }
}

async function main(): Promise<void> {
  logger.info("Checkpoint worker starting", {
    pollIntervalMs: config.pollIntervalMs,
    maxIntervalMs: config.maxIntervalMs,
    batchThreshold: config.batchThreshold,
    verificationIntervalMs: config.verificationIntervalMs,
    rowAuthentication: getLedgerAuthKey() ? "on" : "OFF",
  });
  if (!getLedgerAuthKey()) {
    logger.error(
      "LEDGER_AUTH_KEY is not set: rows are NOT being authenticated, so a forged row with a correct hash would be signed. Set it to the same value as the web app."
    );
  }

  await prisma.$connect();
  logger.info("Connected to database");

  startHealthServer(config.healthPort, state);

  // Poll frequently; the actual checkpoint decision (interval vs. batch
  // threshold) is evaluated inside runCheckpointCycle per organisation.
  const intervalSeconds = Math.max(1, Math.round(config.pollIntervalMs / 1000));
  const cronExpression = `*/${Math.min(intervalSeconds, 59)} * * * * *`;

  await tick();
  cron.schedule(cronExpression, () => {
    void tick();
  });

  logger.info("Entered scheduling loop", { cronExpression });
}

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down");
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
