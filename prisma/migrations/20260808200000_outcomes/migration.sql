-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "targetRoas" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "invoiceNote" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "qualityComment" TEXT,
ADD COLUMN     "qualityRatedAt" TIMESTAMP(3),
ADD COLUMN     "qualityRating" INTEGER;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "bonusQualityHigh" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "defaultTargetRoas" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "healthWeightBlocked" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "healthWeightDelivery" INTEGER NOT NULL DEFAULT 35,
ADD COLUMN     "healthWeightPayment" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "healthWeightRoas" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "paymentOverdueDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "penaltyQualityLow" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "roasAlertWeeks" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "ClientKpiEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "googleSpend" INTEGER NOT NULL DEFAULT 0,
    "metaSpend" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "storeSessions" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientKpiEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientKpiEntry_clientId_weekStart_idx" ON "ClientKpiEntry"("clientId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "ClientKpiEntry_clientId_weekStart_key" ON "ClientKpiEntry"("clientId", "weekStart");

-- CreateIndex
CREATE INDEX "Project_paymentStatus_idx" ON "Project"("paymentStatus");

-- AddForeignKey
ALTER TABLE "ClientKpiEntry" ADD CONSTRAINT "ClientKpiEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientKpiEntry" ADD CONSTRAINT "ClientKpiEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

