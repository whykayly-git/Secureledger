-- Keyed authentication tag on each chain row. Nullable: rows written before
-- tagging was switched on have none, and are accepted only if created before
-- the LEDGER_AUTH_START date configured for the deployment.
ALTER TABLE "ledger_chain" ADD COLUMN "authTag" TEXT;
