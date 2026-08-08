import { prisma } from "@/lib/prisma";
import { applyEvents } from "@/lib/score-service";
import { agencyYearMonth } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { karachiDay } from "@/lib/attendance-time";
import { checksCoveredByOutage, type OutageType } from "@/lib/fairness-windows";

/**
 * Declared outages.
 *
 * Load-shedding is a fact of working in Karachi, and so is a link that drops
 * for an hour. A member who could not physically answer a check has not failed
 * a reachability test — but neither can the app take their word for it without
 * making the whole system optional. So a declared outage suspends the charge
 * and hands the decision to the owner.
 *
 * Three things keep it honest:
 *
 *   A **monthly cap**, so "the power was out" cannot become a standing answer.
 *   **Filed-late is visible** but allowed: an outage stops you filing a report
 *   about it, so refusing late reports would deny the excuse to exactly the
 *   people with the worst outages. The owner sees the flag and judges.
 *   **Rejection reinstates the charge**, and approval reverses it through the
 *   same compensating MANUAL_ADJUST the ledger uses everywhere else.
 */

export type FileOutageResult =
  | { ok: true; id: string; checksCovered: number; filedLate: boolean }
  | { ok: false; reason: string; field?: string };

export async function fileOutage(options: {
  userId: string;
  type: OutageType;
  startsAt: Date;
  endsAt: Date;
  note: string;
  now?: Date;
}): Promise<FileOutageResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  if (options.endsAt <= options.startsAt) {
    return { ok: false, reason: "The outage has to end after it started.", field: "endsAt" };
  }

  const hours = (options.endsAt.getTime() - options.startsAt.getTime()) / 3_600_000;
  if (hours > settings.outageMaxHours) {
    return {
      ok: false,
      reason: `A single report can cover at most ${settings.outageMaxHours} hours. File a second one if it ran longer.`,
      field: "endsAt",
    };
  }

  if (options.startsAt > now) {
    return {
      ok: false,
      reason: "You can't report an outage that hasn't happened yet.",
      field: "startsAt",
    };
  }

  const cycle = agencyYearMonth(now);
  const monthStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 1));

  const usedThisMonth = await prisma.outageReport.count({
    where: { userId: options.userId, createdAt: { gte: monthStart, lt: monthEnd } },
  });

  if (usedThisMonth >= settings.outageReportsPerMonth) {
    return {
      ok: false,
      reason: `You've used all ${settings.outageReportsPerMonth} outage reports this month. Talk to the owner.`,
    };
  }

  // Which checks this covers, and whether any of them already expired — that
  // is what "filed late" means, and it is a fact for the owner, not a verdict.
  const day = karachiDay(options.startsAt);
  const candidates = await prisma.availabilityCheck.findMany({
    where: {
      day: { userId: options.userId, date: day },
      status: { in: ["SCHEDULED", "ACTIVE", "MISSED", "PENDING_REVIEW"] },
    },
  });

  const covered = checksCoveredByOutage(candidates, {
    start: options.startsAt,
    end: options.endsAt,
  });
  const filedLate = covered.some((check) => check.status === "MISSED");

  const report = await prisma.outageReport.create({
    data: {
      userId: options.userId,
      type: options.type,
      startsAt: options.startsAt,
      endsAt: options.endsAt,
      note: options.note,
      filedLate,
    },
  });

  if (covered.length > 0) {
    await prisma.availabilityCheck.updateMany({
      where: { id: { in: covered.map((check) => check.id) } },
      data: { status: "PENDING_REVIEW", outageReportId: report.id },
    });
  }

  for (const admin of await admins()) {
    await notify({
      userId: admin.id,
      type: "REVIEW_OVERDUE",
      title: "Outage reported",
      body: `${covered.length} availability check${covered.length === 1 ? "" : "s"} on hold pending your decision.${
        filedLate ? " Filed after a check had already expired." : ""
      }`,
      href: "/attendance",
    });
  }

  return { ok: true, id: report.id, checksCovered: covered.length, filedLate };
}

export type ReviewOutageResult =
  | { ok: true; excused: number; charged: number; reversed: number }
  | { ok: false; reason: string };

/**
 * The owner's decision on an outage.
 *
 * Approve: covered checks become EXCUSED. Any that had already been charged
 * before the report arrived get a compensating MANUAL_ADJUST — the original
 * penalty is never deleted, exactly as with an excused attendance event.
 *
 * Reject: the checks become MISSED and are charged now. A check that was
 * already charged is not charged twice; the dedupe key sees to that.
 */
export async function reviewOutage(options: {
  reportId: string;
  adminId: string;
  approve: boolean;
  adminNote?: string | null;
  now?: Date;
}): Promise<ReviewOutageResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  const report = await prisma.outageReport.findUnique({
    where: { id: options.reportId },
    include: { checks: true, user: { select: { id: true, name: true } } },
  });
  if (!report) return { ok: false, reason: "That report no longer exists." };
  if (report.status !== "PENDING") {
    return { ok: false, reason: "That report has already been decided." };
  }

  let excused = 0;
  let charged = 0;
  let reversed = 0;

  for (const check of report.checks) {
    if (options.approve) {
      await prisma.availabilityCheck.update({
        where: { id: check.id },
        data: { status: "EXCUSED" },
      });
      excused += 1;

      // Reverse a charge that landed before the report did.
      const original = await prisma.scoreEvent.findUnique({
        where: { dedupeKey: `check:${check.id}:MISS` },
      });
      if (original && original.points < 0) {
        const cycle = agencyYearMonth(original.createdAt);
        try {
          await prisma.scoreEvent.create({
            data: {
              userId: original.userId,
              milestoneId: null,
              type: "MANUAL_ADJUST",
              points: Math.abs(original.points),
              reason: `Excused: missed availability check — outage reported (${report.type.toLowerCase()}).`,
              year: cycle.year,
              month: cycle.month,
              dedupeKey: `excuse:${original.id}`,
              createdById: options.adminId,
            },
          });
          reversed += 1;
        } catch {
          // Already reversed. The unique dedupe key is the guard.
        }
      }
    } else {
      await prisma.availabilityCheck.update({
        where: { id: check.id },
        data: { status: "MISSED" },
      });

      charged += await applyEvents(
        [
          {
            userId: report.userId,
            milestoneId: null,
            type: "ATTENDANCE_MISS",
            points: -Math.abs(settings.penaltyMissedCheck),
            reason: `Missed availability check — the outage report was not upheld.`,
            dedupeKey: `check:${check.id}:MISS`,
          },
        ],
        { at: check.windowEndsAt, createdById: options.adminId },
      );
    }
  }

  await prisma.outageReport.update({
    where: { id: report.id },
    data: {
      status: options.approve ? "APPROVED" : "REJECTED",
      reviewedById: options.adminId,
      reviewedAt: now,
      adminNote: options.adminNote ?? null,
    },
  });

  await notify({
    userId: report.userId,
    type: options.approve ? "WORK_APPROVED" : "WORK_REJECTED",
    title: options.approve ? "Outage accepted" : "Outage not upheld",
    body: options.approve
      ? `${excused} availability check${excused === 1 ? "" : "s"} excused. No points lost.`
      : `The report wasn't upheld${options.adminNote ? `: ${options.adminNote}` : ""}.`,
    href: "/my-attendance",
  });

  return { ok: true, excused, charged, reversed };
}

/** How many reports a member has left this month. */
export async function outageQuotaFor(userId: string, now = new Date()) {
  const settings = await getSettings();
  const cycle = agencyYearMonth(now);
  const monthStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 1));

  const used = await prisma.outageReport.count({
    where: { userId, createdAt: { gte: monthStart, lt: monthEnd } },
  });

  return {
    used,
    allowance: settings.outageReportsPerMonth,
    remaining: Math.max(0, settings.outageReportsPerMonth - used),
    maxHours: settings.outageMaxHours,
  };
}

async function admins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
}
