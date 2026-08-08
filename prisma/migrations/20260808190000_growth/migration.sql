-- AlterTable
ALTER TABLE "User" ADD COLUMN     "weeklyCapacityHours" INTEGER NOT NULL DEFAULT 40;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "renewedFromId" TEXT;

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "carriedFromId" TEXT,
ADD COLUMN     "carriedOver" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimatedHours" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "autoRenewEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bonusDealWon" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "bonusTargetMet" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "carryOverDueDays" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "penaltyTargetMissed" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "targetMissThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'OUTREACH',
    "country" TEXT,
    "interestedServices" TEXT NOT NULL DEFAULT '',
    "estimatedMonthlyValue" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lostReason" TEXT,
    "lostNote" TEXT,
    "notes" TEXT,
    "convertedClientId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "weeklyTarget" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MrrSnapshot" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "activeClients" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MrrSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_convertedClientId_key" ON "Lead"("convertedClientId");

-- CreateIndex
CREATE INDEX "Lead_stage_stageChangedAt_idx" ON "Lead"("stage", "stageChangedAt");

-- CreateIndex
CREATE INDEX "Lead_ownerId_stage_idx" ON "Lead"("ownerId", "stage");

-- CreateIndex
CREATE INDEX "SalesActivity_userId_occurredAt_idx" ON "SalesActivity"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "SalesActivity_leadId_occurredAt_idx" ON "SalesActivity"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityTarget_userId_isActive_idx" ON "ActivityTarget"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityTarget_userId_bucket_key" ON "ActivityTarget"("userId", "bucket");

-- CreateIndex
CREATE INDEX "MrrSnapshot_year_month_idx" ON "MrrSnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MrrSnapshot_year_month_key" ON "MrrSnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Project_renewedFromId_key" ON "Project"("renewedFromId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_carriedFromId_key" ON "Milestone"("carriedFromId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesActivity" ADD CONSTRAINT "SalesActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTarget" ADD CONSTRAINT "ActivityTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

