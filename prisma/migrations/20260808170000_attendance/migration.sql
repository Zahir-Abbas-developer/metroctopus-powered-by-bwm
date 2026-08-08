-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "totalMinutes" INTEGER,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityCheck" (
    "id" TEXT NOT NULL,
    "attendanceDayId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "shiftStartMinutes" INTEGER NOT NULL DEFAULT 720,
    "shiftEndMinutes" INTEGER NOT NULL DEFAULT 1320,
    "clockInOpensMinutes" INTEGER NOT NULL DEFAULT 690,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "absentCutoffMinutes" INTEGER NOT NULL DEFAULT 900,
    "checksPerDay" INTEGER NOT NULL DEFAULT 3,
    "checkWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "checkEarliestOffsetMinutes" INTEGER NOT NULL DEFAULT 45,
    "checkLatestMinutes" INTEGER NOT NULL DEFAULT 1260,
    "checkMinGapMinutes" INTEGER NOT NULL DEFAULT 90,
    "penaltyLateClockIn" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "penaltyAbsentDay" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "penaltyMissedCheck" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "workdays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceDay_date_idx" ON "AttendanceDay"("date");

-- CreateIndex
CREATE INDEX "AttendanceDay_userId_date_idx" ON "AttendanceDay"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_userId_date_key" ON "AttendanceDay"("userId", "date");

-- CreateIndex
CREATE INDEX "AvailabilityCheck_attendanceDayId_idx" ON "AvailabilityCheck"("attendanceDayId");

-- CreateIndex
CREATE INDEX "AvailabilityCheck_status_scheduledAt_idx" ON "AvailabilityCheck"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AvailabilityCheck_status_windowEndsAt_idx" ON "AvailabilityCheck"("status", "windowEndsAt");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_date_idx" ON "LeaveRequest"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_userId_date_key" ON "LeaveRequest"("userId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityCheck" ADD CONSTRAINT "AvailabilityCheck_attendanceDayId_fkey" FOREIGN KEY ("attendanceDayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

