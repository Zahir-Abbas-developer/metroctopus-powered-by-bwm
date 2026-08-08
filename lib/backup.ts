import { prisma } from "@/lib/prisma";

/**
 * Nightly database backups.
 *
 * **Read this before relying on it.** The primary backup for a production
 * deployment is the managed provider's own snapshots — Neon's point-in-time
 * restore, Supabase's daily backups. Those are continuous, off-host, and
 * tested by someone whose job it is. This job is a *second* copy and a
 * liveness signal, not the plan.
 *
 * What it actually does is run `pg_dump` to `BACKUP_DIR` and record the
 * attempt, so "when did we last have a good copy?" has an answer on a screen
 * rather than in someone's memory. If `pg_dump` isn't on the host — it isn't,
 * on Vercel — the run records itself as SKIPPED, which is honest: a backup
 * system that reports success when it did nothing is worse than none.
 *
 * The restore procedure is in README.md. A backup nobody has restored from is
 * a hypothesis.
 */

export type BackupResult = {
  status: "OK" | "SKIPPED" | "FAILED";
  location: string | null;
  sizeBytes: number | null;
  error: string | null;
  durationMs: number;
};

export function backupConfigured(): boolean {
  return Boolean(process.env.BACKUP_DIR) && isPostgres();
}

function isPostgres(): boolean {
  return (process.env.DATABASE_URL ?? "").startsWith("postgres");
}

export async function runBackup(now = new Date()): Promise<BackupResult> {
  const started = Date.now();

  const record = await prisma.backupRun.create({
    data: { startedAt: now, status: "RUNNING" },
  });

  const finish = async (result: Omit<BackupResult, "durationMs">) => {
    await prisma.backupRun
      .update({
        where: { id: record.id },
        data: {
          finishedAt: new Date(),
          status: result.status,
          location: result.location,
          sizeBytes: result.sizeBytes,
          error: result.error,
        },
      })
      .catch(() => {});

    return { ...result, durationMs: Date.now() - started };
  };

  if (!isPostgres()) {
    return finish({
      status: "SKIPPED",
      location: null,
      sizeBytes: null,
      error: "Not a Postgres database — local SQLite is the file itself.",
    });
  }

  if (!process.env.BACKUP_DIR) {
    return finish({
      status: "SKIPPED",
      location: null,
      sizeBytes: null,
      error: "BACKUP_DIR is unset. The provider's own snapshots are the primary backup.",
    });
  }

  try {
    // Imported lazily: these are Node built-ins that must never be reachable
    // from a client bundle, and the whole function is a no-op on Vercel.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { mkdir, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const run = promisify(execFile);
    const dir = process.env.BACKUP_DIR;
    await mkdir(dir, { recursive: true });

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `agency-os-${stamp}.dump`);

    // Custom format: compressed, and restorable selectively with pg_restore.
    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${file}`,
      process.env.DATABASE_URL!,
    ]);

    const info = await stat(file);

    return finish({
      status: "OK",
      location: file,
      sizeBytes: info.size,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // pg_dump missing is a configuration fact, not a failure to alarm about.
    if (/ENOENT/.test(message)) {
      return finish({
        status: "SKIPPED",
        location: null,
        sizeBytes: null,
        error: "pg_dump is not installed on this host. Use the provider's snapshots.",
      });
    }

    return finish({ status: "FAILED", location: null, sizeBytes: null, error: message });
  }
}

/** The most recent attempts, for the settings panel. */
export async function recentBackups(take = 10) {
  return prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take });
}
