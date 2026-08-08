import type { ActivityBucket } from "@/lib/pipeline-types";

/**
 * Weekly activity targets, and what they are worth.
 *
 * Pure: no Prisma, no clock. Business development is scored on activity and
 * outcomes rather than milestones — a pipeline doesn't decompose into dated
 * deliverables — but it feeds the *same* ScoreEvent ledger, so a member's
 * score stays `100 + sum(that month's events)` however they earn it.
 *
 * The asymmetry between met and missed is deliberate. Hitting a target is +1;
 * missing one only costs a point below 60% of the number. A target you fall
 * 5% short of after a week of real work is not a failure, and charging for it
 * would make people pad the count with cheap activity — which is exactly the
 * behaviour a target is supposed to prevent.
 */

export type TargetProgress = {
  bucket: ActivityBucket;
  target: number;
  logged: number;
  /** 0–1, uncapped so 130% of a target still reads as 1.3. */
  ratio: number;
  /** Capped at 100 for a progress bar. */
  percent: number;
  met: boolean;
  /** Below the miss threshold, and therefore chargeable. */
  missed: boolean;
};

export type TargetOutcome = {
  progress: TargetProgress[];
  metCount: number;
  missedCount: number;
  /** Net points the week is worth. */
  points: number;
};

export type TargetConfig = {
  bonusTargetMet: number;
  penaltyTargetMissed: number;
  /** Share of the target below which the week counts as missed. */
  missThreshold: number;
};

export const DEFAULT_TARGET_CONFIG: TargetConfig = {
  bonusTargetMet: 1,
  penaltyTargetMissed: 1,
  missThreshold: 0.6,
};

/**
 * Where one bucket landed for the week.
 *
 * A target of zero is treated as "not set" rather than "instantly met": it
 * would otherwise pay a point every week for a bucket nobody is being asked
 * to work.
 */
export function evaluateTarget(
  bucket: ActivityBucket,
  target: number,
  logged: number,
  config: TargetConfig = DEFAULT_TARGET_CONFIG,
): TargetProgress {
  if (target <= 0) {
    return { bucket, target: 0, logged, ratio: 1, percent: 100, met: false, missed: false };
  }

  const ratio = logged / target;

  return {
    bucket,
    target,
    logged,
    ratio,
    percent: Math.min(100, Math.round(ratio * 100)),
    met: logged >= target,
    missed: ratio < config.missThreshold,
  };
}

/** The whole week across every bucket the member has a target for. */
export function evaluateWeek(
  targets: readonly { bucket: ActivityBucket; weeklyTarget: number }[],
  countsByBucket: Readonly<Partial<Record<ActivityBucket, number>>>,
  config: TargetConfig = DEFAULT_TARGET_CONFIG,
): TargetOutcome {
  const progress = targets.map((entry) =>
    evaluateTarget(entry.bucket, entry.weeklyTarget, countsByBucket[entry.bucket] ?? 0, config),
  );

  const metCount = progress.filter((row) => row.met).length;
  const missedCount = progress.filter((row) => row.missed).length;

  return {
    progress,
    metCount,
    missedCount,
    points: round(
      metCount * Math.abs(config.bonusTargetMet) -
        missedCount * Math.abs(config.penaltyTargetMissed),
    ),
  };
}

/**
 * The sentence under a target bar.
 *
 * Written to be readable mid-week as well as at the end of one — "12 of 40"
 * on a Tuesday is information, not an accusation.
 */
export function describeProgress(progress: TargetProgress): string {
  if (progress.target <= 0) return "No target set";
  if (progress.met) return `${progress.logged} of ${progress.target} — target met`;
  return `${progress.logged} of ${progress.target}`;
}

/** Green at or above target, amber on track, red below the miss threshold. */
export function targetTone(
  progress: TargetProgress,
  config: TargetConfig = DEFAULT_TARGET_CONFIG,
): "success" | "warning" | "danger" | "neutral" {
  if (progress.target <= 0) return "neutral";
  if (progress.met) return "success";
  if (progress.ratio < config.missThreshold) return "danger";
  return "warning";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
