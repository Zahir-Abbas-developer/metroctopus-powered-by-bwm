-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "adminReviewMinutes" INTEGER,
ADD COLUMN     "blockedMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blockedNote" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "blockedSince" TIMESTAMP(3),
ADD COLUMN     "blockingMilestoneId" TEXT,
ADD COLUMN     "statusBeforeBlock" TEXT;

-- AlterTable
ALTER TABLE "AvailabilityCheck" ADD COLUMN     "deferrals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outageReportId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "breakAllowanceMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "outageMaxHours" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "outageReportsPerMonth" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "reviewSlaHours" INTEGER NOT NULL DEFAULT 48;

-- CreateTable
CREATE TABLE "BlockPeriod" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "blockingMilestoneId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "createdById" TEXT NOT NULL,
    "releasedById" TEXT,
    "vetoed" BOOLEAN NOT NULL DEFAULT false,
    "vetoNote" TEXT,

    CONSTRAINT "BlockPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutageReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filedLate" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockPeriod_milestoneId_idx" ON "BlockPeriod"("milestoneId");

-- CreateIndex
CREATE INDEX "BlockPeriod_reason_startedAt_idx" ON "BlockPeriod"("reason", "startedAt");

-- CreateIndex
CREATE INDEX "OutageReport_userId_startsAt_idx" ON "OutageReport"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "OutageReport_status_createdAt_idx" ON "OutageReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BreakSession_userId_date_idx" ON "BreakSession"("userId", "date");

-- CreateIndex
CREATE INDEX "BreakSession_userId_endedAt_idx" ON "BreakSession"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Milestone_blockingMilestoneId_idx" ON "Milestone"("blockingMilestoneId");

-- CreateIndex
CREATE INDEX "Milestone_status_submittedAt_idx" ON "Milestone"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AvailabilityCheck_outageReportId_idx" ON "AvailabilityCheck"("outageReportId");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_blockingMilestoneId_fkey" FOREIGN KEY ("blockingMilestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockPeriod" ADD CONSTRAINT "BlockPeriod_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockPeriod" ADD CONSTRAINT "BlockPeriod_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockPeriod" ADD CONSTRAINT "BlockPeriod_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityCheck" ADD CONSTRAINT "AvailabilityCheck_outageReportId_fkey" FOREIGN KEY ("outageReportId") REFERENCES "OutageReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutageReport" ADD CONSTRAINT "OutageReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutageReport" ADD CONSTRAINT "OutageReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakSession" ADD CONSTRAINT "BreakSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

