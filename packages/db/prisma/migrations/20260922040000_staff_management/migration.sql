-- AlterTable
ALTER TABLE "users" ADD COLUMN "isOrgAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Backfill: every organisation that predates this migration must still end
-- up with at least one admin, or the "Manage Staff" module (and its "block
-- removing the last admin" safeguard) would be unreachable for it. The
-- earliest-created user per organisation becomes its admin, matching the
-- new /register behaviour going forward (the first user of a brand new
-- organisation is always isOrgAdmin = true).
WITH first_user_per_org AS (
  SELECT DISTINCT ON ("organisationId") id
  FROM "users"
  ORDER BY "organisationId", "createdAt" ASC, id ASC
)
UPDATE "users"
SET "isOrgAdmin" = true
WHERE id IN (SELECT id FROM first_user_per_org);

-- AlterTable: admin_action_logs.userId becomes nullable so a hard-deleted
-- staff member who once acted as an admin (invited someone, changed a
-- role, etc.) doesn't leave a dangling required foreign key — the log row
-- must survive their removal, only the actor reference is cleared.
ALTER TABLE "admin_action_logs" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "admin_action_logs" DROP CONSTRAINT "admin_action_logs_userId_fkey";
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
