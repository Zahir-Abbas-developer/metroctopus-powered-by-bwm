import type { BadgeTone } from "@/components/ui/Badge";
import type { ScoreEventType } from "@/lib/scoring";
import { toDateOnly } from "@/lib/date";

/**
 * The vocabulary of a report: its types, labels and payload shape.
 *
 * Split out from lib/reports.ts because client components need these, and
 * lib/reports.ts reaches Prisma and the mail transport. Importing the labels
 * used to drag both into the browser bundle — which only became visible when
 * `server-only` turned it into a build error.
 */

export const REPORT_TYPES = ["MEMBER_WEEKLY", "MEMBER_MONTHLY", "CLIENT_WEEKLY"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  MEMBER_WEEKLY: "Weekly performance",
  MEMBER_MONTHLY: "Monthly performance",
  CLIENT_WEEKLY: "Client weekly",
};

export const REPORT_TYPE_TONE: Record<ReportType, BadgeTone> = {
  MEMBER_WEEKLY: "info",
  MEMBER_MONTHLY: "success",
  CLIENT_WEEKLY: "neutral",
};

/** Bumped if the payload shape ever changes; old reports keep their version. */
export const PAYLOAD_VERSION = 1 as const;

/**
 * The attendance half of a member report.
 *
 * Optional rather than required, and the version stays at 1: it was added in
 * Phase 7 and every report frozen before then simply doesn't have it. Making it
 * required would mean claiming reports contain a section they never did.
 */
export type ReportBusinessDevelopment = {
  activities: number;
  byBucket: { bucket: string; count: number }[];
  leadsWorked: number;
  stageConversion: { from: string; entered: number }[];
  dealsWon: number;
  dealsLost: number;
  /** Monthly recurring value of the deals closed in this period. */
  revenueAdded: number;
};

export type ReportAttendance = {
  daysPresent: number;
  daysLate: number;
  daysAbsent: number;
  daysOnLeave: number;
  checksPassed: number;
  checksTotal: number;
  /** Null when no check was answered in the period. */
  avgResponseSeconds: number | null;
  minutesWorked: number;
};

export type MemberReportPayload = {
  version: typeof PAYLOAD_VERSION;
  kind: "MEMBER";
  member: { id: string; name: string; jobTitle: string; avatarColor: string };
  period: { start: string; end: string; label: string; phrase: string };
  score: {
    value: number;
    bandKey: string;
    bandLabel: string;
    bandColor: string;
    previous: number | null;
    delta: number | null;
  };
  points: { gained: number; lost: number; net: number };
  events: {
    id: string;
    type: ScoreEventType;
    points: number;
    reason: string;
    at: string;
    milestoneTitle: string | null;
    clientName: string | null;
  }[];
  milestones: {
    completed: number;
    onTime: number;
    late: number;
    missed: number;
    rejected: number;
  };
  onTimeRate: number;
  /**
   * The volume the score was earned against. Absent on reports frozen before
   * Phase 8; every report from then on carries it, because the doctrine
   * forbids presenting a score without it.
   */
  load?: { count: number; weight: number; rank: number | null };
  /** Absent on reports frozen before Phase 7. */
  attendance?: ReportAttendance;
  /**
   * Hours of work carried, for the load line. Added in Phase 9; absent on
   * anything frozen before it.
   */
  capacity?: { hours: number; milestones: number; capacityHours: number; percent: number };
  /**
   * Business development. Present only for members with pipeline activity —
   * sales work is scored on activity and outcomes rather than milestones, so
   * a delivery member's report simply doesn't have this section.
   */
  businessDevelopment?: ReportBusinessDevelopment;
  narrative: { second: string; third: string };
};

export type ClientReportPayload = {
  version: typeof PAYLOAD_VERSION;
  kind: "CLIENT";
  client: { id: string; name: string; industry: string | null };
  period: { start: string; end: string; label: string };
  project: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    completionPercent: number;
    total: number;
    done: number;
  } | null;
  /**
   * Work paused waiting on the client. Absent on reports frozen before Phase 8.
   * Deliberately phrased as items awaiting input rather than as blame: it is a
   * prompt to unblock, and incidentally the record if a deadline is disputed.
   */
  awaitingInput?: {
    totalDays: number;
    items: { title: string; since: string; note: string; days: number }[];
  };
  completedThisPeriod: {
    module: string;
    title: string;
    completedAt: string;
    assignee: string | null;
  }[];
  plannedNextPeriod: {
    module: string;
    title: string;
    dueDate: string;
    assignee: string | null;
  }[];
  overdue: {
    module: string;
    title: string;
    dueDate: string;
    assignee: string | null;
    daysLate: number;
  }[];
  narrative: string;
};

export type ReportPayload = MemberReportPayload | ClientReportPayload;

/** Reports are keyed by what they describe, so regenerating is a no-op. */
export function reportDedupeKey(
  type: ReportType,
  periodStart: Date,
  subjectId: string,
): string {
  return `${type}:${toDateOnly(periodStart).toISOString().slice(0, 10)}:${subjectId}`;
}

export function parsePayload(raw: string): ReportPayload {
  return JSON.parse(raw) as ReportPayload;
}
