/**
 * Client health: one number, from four things that actually predict a churn.
 *
 * Pure — no Prisma, no clock, no fetching. The formula is the whole point of
 * the feature, so it lives in one function that can be read end to end and
 * tested exhaustively rather than being spread across a query and a component.
 *
 * ## Why these four
 *
 * **Delivery** — are we doing what we said, on time? The thing we control most.
 * **ROAS against target** — is the work making them money? The thing they care
 * about most, and the one that ends retainers.
 * **Payment** — an unpaid invoice is rarely about cash flow. It is usually the
 * first visible symptom of a client who has stopped seeing the value.
 * **Blocked days** — time we spent waiting on them. High numbers mean a
 * disengaged client, and disengaged clients churn even when the work is good.
 *
 * ## What is deliberately not in here
 *
 * No manual input. A health score somebody types is an opinion with a number
 * attached, and it decays the moment whoever maintained it gets busy.
 *
 * No sentiment, no "last contact" recency. Both are easy to game by sending an
 * email, and neither survived the question "would this have caught the last
 * client we lost?"
 */

export type HealthWeights = {
  delivery: number;
  roas: number;
  payment: number;
  blocked: number;
};

export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  delivery: 35,
  roas: 30,
  payment: 20,
  blocked: 15,
};

export type HealthInput = {
  /** Share of this client's milestones delivered by deadline, 0–100. */
  onTimeRate: number | null;
  /** Milestones the rate is computed over — a rate over two is not evidence. */
  deliveredCount: number;

  /** Latest ROAS, and what it is held to. */
  roas: number | null;
  targetRoas: number;
  /** Consecutive weeks under target, from lib/kpi.ts. */
  weeksBelowTarget: number;

  /** "PENDING" | "PAID" | "OVERDUE" on the current cycle. */
  paymentStatus: string;
  /** Cycles unpaid past their due window. */
  overdueCycles: number;

  /** Days of work paused waiting on this client, this engagement. */
  clientBlockedDays: number;
};

export type HealthBand = "HEALTHY" | "WATCH" | "AT_RISK";

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  HEALTHY: "Healthy",
  WATCH: "Watch",
  AT_RISK: "At risk",
};

export const HEALTH_BAND_TONE: Record<HealthBand, "success" | "warning" | "danger"> = {
  HEALTHY: "success",
  WATCH: "warning",
  AT_RISK: "danger",
};

/** Hex from the fixed palette, for the dot on a client card. */
export const HEALTH_BAND_COLOR: Record<HealthBand, string> = {
  HEALTHY: "#1A6B3A",
  WATCH: "#C4730A",
  AT_RISK: "#C0392B",
};

export type HealthComponent = {
  key: keyof HealthWeights;
  label: string;
  /** 0–100 for this dimension alone, or null when there is no evidence. */
  score: number | null;
  weight: number;
  /** One line explaining the number, shown in the tooltip. */
  detail: string;
};

export type ClientHealth = {
  score: number;
  band: HealthBand;
  components: HealthComponent[];
  /** The single biggest drag, for the "At risk" list. Null when all is well. */
  headline: string | null;
};

/**
 * Delivery: the on-time rate, straight through.
 *
 * Null below three delivered milestones. One late milestone out of two is a
 * 50% on-time rate and means almost nothing; letting it drive a third of a
 * health score would put every new client on the at-risk list in week two.
 */
function deliveryScore(input: HealthInput): HealthComponent {
  const enough = input.deliveredCount >= 3 && input.onTimeRate !== null;

  return {
    key: "delivery",
    label: "Delivery",
    score: enough ? clamp(input.onTimeRate!) : null,
    weight: 0,
    detail: enough
      ? `${input.onTimeRate}% of ${input.deliveredCount} milestones on time`
      : `Only ${input.deliveredCount} delivered so far — not enough to judge`,
  };
}

/**
 * ROAS: performance against the client's own target, not an absolute.
 *
 * At target scores 80 rather than 100, so there is headroom to reward a client
 * whose campaigns are genuinely outperforming — and so "exactly on target"
 * doesn't read as a perfect relationship.
 *
 * A sustained shortfall costs more than the ratio alone implies: the streak
 * penalty is what turns two quiet bad weeks into a visible problem.
 */
function roasScore(input: HealthInput): HealthComponent {
  if (input.roas === null || input.targetRoas <= 0) {
    return {
      key: "roas",
      label: "Performance",
      score: null,
      weight: 0,
      detail: "No campaign data yet",
    };
  }

  const ratio = input.roas / input.targetRoas;
  const base = ratio >= 1 ? 80 + Math.min(20, (ratio - 1) * 40) : Math.max(0, ratio * 80);
  const streakPenalty = Math.min(30, Math.max(0, input.weeksBelowTarget - 1) * 15);

  return {
    key: "roas",
    label: "Performance",
    score: clamp(base - streakPenalty),
    weight: 0,
    detail:
      input.weeksBelowTarget >= 2
        ? `ROAS ${input.roas} against a ${input.targetRoas} target — ${input.weeksBelowTarget} weeks below`
        : `ROAS ${input.roas} against a ${input.targetRoas} target`,
  };
}

/** Payment: paid is perfect, pending is fine, overdue falls away fast. */
function paymentScore(input: HealthInput): HealthComponent {
  const score =
    input.paymentStatus === "PAID"
      ? 100
      : input.paymentStatus === "PENDING"
        ? 85
        : Math.max(0, 50 - (input.overdueCycles - 1) * 25);

  return {
    key: "payment",
    label: "Payment",
    score: clamp(score),
    weight: 0,
    detail:
      input.paymentStatus === "OVERDUE"
        ? `${input.overdueCycles} cycle${input.overdueCycles === 1 ? "" : "s"} overdue`
        : input.paymentStatus === "PAID"
          ? "Current cycle paid"
          : "Current cycle not yet due",
  };
}

/**
 * Blocked time: how much of our work sat waiting on them.
 *
 * Full marks up to two days — some back-and-forth is normal and healthy.
 * Beyond that it decays, reaching zero around a fortnight of waiting, which is
 * the point at which a retainer is being paid for on both sides and delivered
 * on neither.
 */
function blockedScore(input: HealthInput): HealthComponent {
  const days = Math.max(0, input.clientBlockedDays);
  const score = days <= 2 ? 100 : Math.max(0, 100 - (days - 2) * 8.5);

  return {
    key: "blocked",
    label: "Responsiveness",
    score: clamp(score),
    weight: 0,
    detail:
      days <= 2
        ? "Responsive — little or no waiting"
        : `${days} day${days === 1 ? "" : "s"} of our work paused waiting on them`,
  };
}

/**
 * The blended score.
 *
 * A dimension with no evidence is dropped and its weight redistributed across
 * the rest, rather than counted as zero. A brand-new client with no campaign
 * data is not performing badly — nothing is known yet, and scoring the unknown
 * as failure would mark every new retainer at risk on day one.
 */
export function clientHealth(
  input: HealthInput,
  weights: HealthWeights = DEFAULT_HEALTH_WEIGHTS,
): ClientHealth {
  const normalised = normaliseWeights(weights);

  const components = [
    deliveryScore(input),
    roasScore(input),
    paymentScore(input),
    blockedScore(input),
  ].map((component) => ({ ...component, weight: normalised[component.key] }));

  const scored = components.filter((component) => component.score !== null);
  const totalWeight = scored.reduce((sum, component) => sum + component.weight, 0);

  // Nothing measurable at all — a client onboarded this morning. Optimistic
  // rather than alarming, and honest about why in the headline.
  if (scored.length === 0 || totalWeight === 0) {
    return {
      score: 100,
      band: "HEALTHY",
      components,
      headline: null,
    };
  }

  const score = Math.round(
    scored.reduce((sum, component) => sum + component.score! * component.weight, 0) / totalWeight,
  );

  const worst = [...scored].sort((a, b) => a.score! - b.score!)[0];

  return {
    score,
    band: healthBand(score),
    components,
    // Only name a problem when there is one. A "biggest weakness" on a healthy
    // client is an invitation to fix something that isn't broken.
    headline: worst.score! < 70 ? worst.detail : null,
  };
}

/** Healthy from 75, watch from 55, at risk below. */
export function healthBand(score: number): HealthBand {
  if (score >= 75) return "HEALTHY";
  if (score >= 55) return "WATCH";
  return "AT_RISK";
}

/**
 * Weights as fractions that sum to 1.
 *
 * Defensive because they are configurable: an owner who sets them to 40/40/40/40
 * has expressed relative importance perfectly clearly, and refusing to render
 * a dashboard over it would be pedantry.
 */
export function normaliseWeights(weights: HealthWeights): HealthWeights {
  const total =
    Math.max(0, weights.delivery) +
    Math.max(0, weights.roas) +
    Math.max(0, weights.payment) +
    Math.max(0, weights.blocked);

  if (total <= 0) return { delivery: 0.25, roas: 0.25, payment: 0.25, blocked: 0.25 };

  return {
    delivery: Math.max(0, weights.delivery) / total,
    roas: Math.max(0, weights.roas) / total,
    payment: Math.max(0, weights.payment) / total,
    blocked: Math.max(0, weights.blocked) / total,
  };
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
