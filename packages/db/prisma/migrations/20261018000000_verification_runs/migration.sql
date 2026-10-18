-- CreateTable
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "totalRecords" INTEGER NOT NULL,
    "checkedRecords" INTEGER NOT NULL,
    "verifiedCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "continuityIntact" BOOLEAN NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "problemSignature" TEXT,
    "details" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_runs_organisationId_createdAt_idx" ON "verification_runs"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
