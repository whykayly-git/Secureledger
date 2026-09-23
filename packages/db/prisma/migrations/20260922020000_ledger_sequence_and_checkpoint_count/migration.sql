-- AlterTable
ALTER TABLE "ledger_chain" ADD COLUMN "sequenceNumber" INTEGER;

-- Backfill: assign a per-organisation, monotonically increasing position to
-- every existing row, ordered by createdAt (id as tie-breaker for rows
-- created in the same millisecond).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organisationId" ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "ledger_chain"
)
UPDATE "ledger_chain" lc
SET "sequenceNumber" = ranked.rn
FROM ranked
WHERE lc.id = ranked.id;

-- AlterTable
ALTER TABLE "ledger_chain" ALTER COLUMN "sequenceNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ledger_chain_organisationId_sequenceNumber_key" ON "ledger_chain"("organisationId", "sequenceNumber");

-- AlterTable
ALTER TABLE "ledger_checkpoints" ADD COLUMN "recordCount" INTEGER;

-- Backfill: recordCount is the actual number of ledger_chain rows currently
-- referencing each checkpoint (accurate for any pre-existing checkpoint
-- that hasn't had rows deleted out from under it since).
UPDATE "ledger_checkpoints" cp
SET "recordCount" = sub.cnt
FROM (
  SELECT "checkpointId", COUNT(*) AS cnt
  FROM "ledger_chain"
  WHERE "checkpointId" IS NOT NULL
  GROUP BY "checkpointId"
) sub
WHERE cp.id = sub."checkpointId";

-- Any checkpoint with zero surviving rows referencing it (edge case, not
-- expected in practice) backfills to 0 rather than leaving it NULL.
UPDATE "ledger_checkpoints" SET "recordCount" = 0 WHERE "recordCount" IS NULL;

-- AlterTable
ALTER TABLE "ledger_checkpoints" ALTER COLUMN "recordCount" SET NOT NULL;
