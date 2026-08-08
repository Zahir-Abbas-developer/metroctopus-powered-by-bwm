-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "backupWarnHours" INTEGER NOT NULL DEFAULT 26,
ADD COLUMN     "bonusStreakMonths" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "bonusThresholdScore" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "defaultBonusPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "disputeSlaHours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "disputeWindowDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "leadEscalationHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "leaderboardVisibility" TEXT NOT NULL DEFAULT 'ADMIN_ONLY',
ADD COLUMN     "reviewThresholdScore" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "reviewTriggerCount" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "reviewWindowMonths" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "ServiceLead" (
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceLead_pkey" PRIMARY KEY ("userId","serviceId")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "scoreEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "resolvedAsLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeFile" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncentiveAward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "streakMonths" INTEGER NOT NULL DEFAULT 0,
    "evidence" TEXT NOT NULL,
    "bonusAmount" DOUBLE PRECISION,
    "bonusPercent" DOUBLE PRECISION,
    "actionedAt" TIMESTAMP(3),
    "actionedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentiveAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "asLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "summary" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "location" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceLead_serviceId_idx" ON "ServiceLead"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_scoreEventId_key" ON "Dispute"("scoreEventId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_userId_createdAt_idx" ON "Dispute"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeFile_storedName_key" ON "DisputeFile"("storedName");

-- CreateIndex
CREATE INDEX "DisputeFile_disputeId_idx" ON "DisputeFile"("disputeId");

-- CreateIndex
CREATE INDEX "IncentiveAward_type_year_month_idx" ON "IncentiveAward"("type", "year", "month");

-- CreateIndex
CREATE INDEX "IncentiveAward_userId_createdAt_idx" ON "IncentiveAward"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncentiveAward_userId_type_year_month_key" ON "IncentiveAward"("userId", "type", "year", "month");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- AddForeignKey
ALTER TABLE "ServiceLead" ADD CONSTRAINT "ServiceLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLead" ADD CONSTRAINT "ServiceLead_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_scoreEventId_fkey" FOREIGN KEY ("scoreEventId") REFERENCES "ScoreEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeFile" ADD CONSTRAINT "DisputeFile_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeFile" ADD CONSTRAINT "DisputeFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncentiveAward" ADD CONSTRAINT "IncentiveAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

