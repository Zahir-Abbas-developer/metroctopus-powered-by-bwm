import { prisma } from "@/lib/prisma";
import { addDays, dueDeadline, formatDate } from "@/lib/date";
import { currentCycle, scoresForCycle } from "@/lib/score-service";
import { REPORT_TYPE_LABEL, parsePayload, type ReportType } from "@/lib/reports";
import type { SendResult } from "@/lib/email/send";
import {
  overdueAlertEmail,
  renewalDigestEmail,
  reportReadyEmail,
  weeklyDigestEmail,
  welcomeEmail,
} from "@/lib/email/templates";

/**
 * The four messages the product sends, each assembled from live data.
 *
 * Every function here returns rather than throws — see lib/email/send.ts. The
 * caller has already done the real work by the time one of these runs.
 *
 * The transport is imported lazily. lib/email/send.ts is marked `server-only`,
 * which throws outside a React Server environment, and this module is reachable
 * from CLI scripts (the seed generates reports). Deferring the import keeps
 * those scripts working while the guard still protects the client bundle.
 */

async function transport() {
  return import("@/lib/email/send");
}

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "SUBMITTED"];

/** Sent when the owner adds a member, carrying the password they were given. */
export async function sendWelcome(input: {
  name: string;
  email: string;
  password: string;
  jobTitle: string;
}): Promise<SendResult> {
  const { sendEmail, appUrl } = await transport();
  return sendEmail(
    input.email,
    welcomeEmail({ ...input, signInUrl: `${appUrl()}/login` }),
  );
}

/** Monday digest: this month's score, and what is due in the next seven days. */
export async function sendWeeklyDigests(now = new Date()): Promise<{
  sent: number;
  skipped: number;
}> {
  const { sendEmail, appUrl } = await transport();

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true, name: true, email: true },
  });

  if (members.length === 0) return { sent: 0, skipped: 0 };

  const cycle = currentCycle(now);
  const scores = await scoresForCycle(members.map((m) => m.id), cycle);
  const horizon = addDays(now, 7);

  let sent = 0;
  let skipped = 0;

  for (const member of members) {
    const milestones = await prisma.milestone.findMany({
      where: {
        assigneeId: member.id,
        status: { in: OPEN_STATUSES },
        dueDate: { lte: horizon },
      },
      orderBy: { dueDate: "asc" },
      take: 12,
      include: {
        module: {
          select: { project: { select: { client: { select: { businessName: true } } } } },
        },
      },
    });

    const score = scores.get(member.id);

    const result = await sendEmail(
      member.email,
      weeklyDigestEmail({
        name: member.name,
        score: score?.score ?? 100,
        bandLabel: score?.band.label ?? "Excellent",
        appUrl: appUrl(),
        dueThisWeek: milestones.map((milestone) => ({
          title: milestone.title,
          clientName: milestone.module.project.client.businessName,
          dueLabel: formatDate(milestone.dueDate),
          overdue: dueDeadline(milestone.dueDate) < now,
        })),
      }),
    );

    if (result.status === "sent") sent += 1;
    else skipped += 1;
  }

  return { sent, skipped };
}

/** Sent as each member report is generated. */
export async function sendReportReady(reportId: string): Promise<SendResult> {
  const { sendEmail, appUrl } = await transport();

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { user: { select: { name: true, email: true } } },
  });

  if (!report?.user) {
    return { status: "skipped", reason: "not a member report" };
  }

  const payload = parsePayload(report.payload);
  if (payload.kind !== "MEMBER") {
    return { status: "skipped", reason: "not a member report" };
  }

  return sendEmail(
    report.user.email,
    reportReadyEmail({
      name: report.user.name,
      periodLabel: payload.period.label,
      typeLabel: REPORT_TYPE_LABEL[report.type as ReportType],
      narrative: payload.narrative.second,
      score: payload.score.value,
      reportUrl: `${appUrl()}/reports/${report.id}`,
    }),
  );
}

/** Daily alert to the owner, sent only when something is actually late. */
export async function sendOverdueAlert(now = new Date()): Promise<SendResult> {
  const { sendEmail, appUrl } = await transport();

  const open = await prisma.milestone.findMany({
    where: { status: { in: OPEN_STATUSES } },
    orderBy: { dueDate: "asc" },
    include: {
      assignee: { select: { name: true } },
      module: {
        select: { project: { select: { client: { select: { businessName: true } } } } },
      },
    },
  });

  const overdue = open
    .filter((milestone) => dueDeadline(milestone.dueDate) < now)
    .slice(0, 20)
    .map((milestone) => ({
      title: milestone.title,
      clientName: milestone.module.project.client.businessName,
      assigneeName: milestone.assignee?.name ?? "Unassigned",
      daysLate: Math.max(
        1,
        Math.floor(
          (now.getTime() - dueDeadline(milestone.dueDate).getTime()) / 86_400_000,
        ),
      ),
    }));

  // No news is not worth an email.
  if (overdue.length === 0) {
    return { status: "skipped", reason: "nothing overdue" };
  }

  const owners = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });

  if (owners.length === 0) return { status: "skipped", reason: "no active owner" };

  let last: SendResult = { status: "skipped", reason: "no active owner" };
  for (const owner of owners) {
    last = await sendEmail(owner.email, overdueAlertEmail({ overdue, appUrl: appUrl() }));
  }

  return last;
}

/**
 * The renewals digest.
 *
 * Sent by the nightly job after auto-renewal, and only when it actually did
 * something — an email saying "nothing happened" every night is an email
 * nobody reads by week two.
 */
export async function sendRenewalDigest(run: {
  renewed: {
    clientName: string;
    title: string;
    milestones: number;
    carriedOver: number;
    unassigned: number;
    previousUnpaid?: boolean;
  }[];
  skipped: { clientName: string; reason: string }[];
  totalCarriedOver: number;
}): Promise<SendResult> {
  if (run.renewed.length === 0 && run.skipped.length === 0) {
    return { status: "skipped", reason: "nothing renewed" };
  }

  const { sendEmail, appUrl } = await transport();

  const owners = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { email: true },
  });
  if (owners.length === 0) return { status: "skipped", reason: "no active owner" };

  let last: SendResult = { status: "skipped", reason: "no active owner" };
  for (const owner of owners) {
    last = await sendEmail(
      owner.email,
      renewalDigestEmail({
        renewed: run.renewed,
        skipped: run.skipped,
        totalCarriedOver: run.totalCarriedOver,
        appUrl: appUrl(),
      }),
    );
  }

  return last;
}
