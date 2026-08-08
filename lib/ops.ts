import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

/**
 * Making silent failures loud.
 *
 * Everything scheduled in this product — attendance settlement, renewals,
 * incentives, reports — fails silently by design: each one catches, logs and
 * moves on so a single broken step can't take the whole nightly pass with it.
 * That is the right behaviour and it has one consequence: **nothing tells you
 * it stopped running.** A cron that quietly dies leaves an app that looks
 * perfect and is a week out of date.
 *
 * So every job stamps a row here, and the health endpoint reads them.
 */

export const TRACKED_JOBS = ["evaluate", "backup"] as const;
export type TrackedJob = (typeof TRACKED_JOBS)[number];

/** Marks a job started, and returns a finisher. */
export async function beginJob(job: string, now = new Date()) {
  await prisma.jobRun.upsert({
    where: { job },
    update: { startedAt: now, finishedAt: null, status: "RUNNING", summary: null, durationMs: null },
    create: { job, startedAt: now, status: "RUNNING" },
  });

  return async (status: "OK" | "FAILED", summary: string) => {
    const finishedAt = new Date();
    await prisma.jobRun
      .update({
        where: { job },
        data: {
          finishedAt,
          status,
          summary: summary.slice(0, 500),
          durationMs: finishedAt.getTime() - now.getTime(),
        },
      })
      .catch(() => {});
  };
}

export type JobHealth = {
  job: string;
  status: string;
  lastRunAt: string | null;
  hoursSince: number | null;
  durationMs: number | null;
  summary: string | null;
  /** True when this job is late or failed — what the widget colours on. */
  stale: boolean;
};

/**
 * How each job is doing.
 *
 * A job is "stale" at 26 hours by default rather than 24: a nightly job that
 * runs at 02:00 and is checked at 02:05 the next day is 24 hours and 5 minutes
 * old and perfectly healthy. Alerting at exactly 24 would cry wolf daily.
 */
export async function jobHealth(now = new Date()): Promise<JobHealth[]> {
  const settings = await getSettings();
  const runs = await prisma.jobRun.findMany();
  const byJob = new Map(runs.map((run) => [run.job, run]));

  return TRACKED_JOBS.map((job) => {
    const run = byJob.get(job);
    if (!run) {
      return {
        job,
        status: "NEVER_RUN",
        lastRunAt: null,
        hoursSince: null,
        durationMs: null,
        summary: null,
        stale: true,
      };
    }

    const reference = run.finishedAt ?? run.startedAt;
    const hoursSince = (now.getTime() - reference.getTime()) / 3_600_000;

    return {
      job,
      status: run.status,
      lastRunAt: reference.toISOString(),
      hoursSince: Math.round(hoursSince * 10) / 10,
      durationMs: run.durationMs,
      summary: run.summary,
      stale: run.status === "FAILED" || hoursSince > settings.backupWarnHours,
    };
  });
}

export type HealthReport = {
  status: "ok" | "degraded";
  checkedAt: string;
  database: { ok: boolean; latencyMs: number | null; error?: string };
  jobs: JobHealth[];
  backup: {
    lastAt: string | null;
    hoursSince: number | null;
    status: string | null;
    stale: boolean;
    warnAfterHours: number;
  };
};

/**
 * The whole picture, for /api/health and the dashboard widget.
 *
 * Reports `degraded` rather than throwing, and always returns 200 for the
 * database check itself — a health endpoint that 500s tells an uptime monitor
 * the app is down when the truth might be "the backup is late".
 */
export async function healthReport(now = new Date()): Promise<HealthReport> {
  const settings = await getSettings();

  const started = Date.now();
  let database: HealthReport["database"];
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    database = {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const jobs = database.ok ? await jobHealth(now) : [];

  const lastBackup = database.ok
    ? await prisma.backupRun.findFirst({
        where: { status: "OK" },
        orderBy: { finishedAt: "desc" },
      })
    : null;

  const backupHours = lastBackup?.finishedAt
    ? (now.getTime() - lastBackup.finishedAt.getTime()) / 3_600_000
    : null;

  const backup = {
    lastAt: lastBackup?.finishedAt?.toISOString() ?? null,
    hoursSince: backupHours === null ? null : Math.round(backupHours * 10) / 10,
    status: lastBackup?.status ?? null,
    stale: backupHours === null || backupHours > settings.backupWarnHours,
    warnAfterHours: settings.backupWarnHours,
  };

  return {
    status:
      database.ok && !backup.stale && jobs.every((job) => !job.stale) ? "ok" : "degraded",
    checkedAt: now.toISOString(),
    database,
    jobs,
    backup,
  };
}
