/**
 * Auto-written report summaries.
 *
 * Pure and template-based — no model, no clock, no database. The numbers are
 * computed elsewhere; this only decides how to say them. That keeps the prose
 * testable and, more importantly, keeps it honest: a sentence can only ever
 * restate a fact it was handed.
 *
 * Two voices are produced for every member report. The member reads "You
 * completed…", and the owner reading the same report sees "Ayesha completed…".
 * Both are frozen into the payload so a report never re-words itself later.
 */

import { scoreBand } from "@/lib/scoring";

export type NarrativeVoice = "second" | "third";

export type MemberNarrativeFacts = {
  firstName: string;
  /** "this week" | "this month" — used verbatim in the prose. */
  periodPhrase: string;
  /** "last week" | "last month". */
  previousPhrase: string;
  completedTotal: number;
  completedOnTime: number;
  lateCount: number;
  missedCount: number;
  rejectedCount: number;
  score: number;
  /** Difference against the previous period, or null when there is none. */
  delta: number | null;
  /** Where the worst slip happened, e.g. "Google Ads" — optional. */
  troubleArea?: string | null;
  /**
   * Volume the score was earned against, and how it compares.
   *
   * The Fairness Doctrine forbids a score without context, and that applies to
   * prose as much as to a badge: "91" reads very differently from "91 while
   * carrying the heaviest load on the team".
   */
  load?: {
    count: number;
    /** Rank by load, 1 = heaviest. Null when there is nobody to compare to. */
    rank: number | null;
    teamSize: number;
  } | null;
  /** Omitted for reports frozen before attendance existed. */
  attendance?: {
    checksPassed: number;
    checksTotal: number;
    daysAbsent: number;
    daysLate: number;
  } | null;
};

/**
 * Naive "+s" gives "2 late deliverys". Consonant + y takes -ies, which covers
 * every noun this module uses (delivery, deadline, rejection, milestone, item).
 */
function plural(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

const pluralise = (count: number, word: string) =>
  `${count} ${count === 1 ? word : plural(word)}`;

/** Verb agreement differs between the two voices; everything else is shared. */
function subject(voice: NarrativeVoice, firstName: string) {
  return voice === "second"
    ? { they: "You", verb: (base: string) => base, possessive: "Your" }
    : { they: firstName, verb: (base: string) => `${base}s`, possessive: `${firstName}'s` };
}

export function narrateMemberReport(
  facts: MemberNarrativeFacts,
  voice: NarrativeVoice = "second",
): string {
  const s = subject(voice, facts.firstName);
  const sentences: string[] = [];

  // 1 — delivery.
  if (facts.completedTotal === 0) {
    sentences.push(
      facts.missedCount > 0
        ? `${s.they} had no milestones approved ${facts.periodPhrase}, and ${pluralise(facts.missedCount, "deadline")} passed unfinished.`
        : `${s.they} had no milestones approved ${facts.periodPhrase}.`,
    );
  } else if (facts.completedOnTime === facts.completedTotal) {
    sentences.push(
      facts.completedTotal === 1
        ? `${s.they} completed the ${facts.periodPhrase.replace("this ", "")}'s single milestone on time.`
        : `${s.they} completed all ${facts.completedTotal} milestones on time ${facts.periodPhrase}.`,
    );
  } else {
    sentences.push(
      `${s.they} completed ${facts.completedOnTime} of ${facts.completedTotal} milestones on time ${facts.periodPhrase}.`,
    );
  }

  // 2 — where the score landed, and which way it moved.
  const band = scoreBand(facts.score).label;
  const movement =
    facts.delta === null
      ? ""
      : Math.abs(facts.delta) < 0.05
        ? `, level with ${facts.previousPhrase}`
        : facts.delta > 0
          ? `, up ${formatDelta(facts.delta)} from ${facts.previousPhrase}`
          : `, down ${formatDelta(Math.abs(facts.delta))} from ${facts.previousPhrase}`;

  // Third person avoids naming the subject twice in one sentence — "Ayesha's
  // score places Ayesha in…" reads like a form letter. No pronoun is guessed.
  //
  // The load clause is part of this sentence rather than its own, because a
  // score and the volume behind it are one fact, not two.
  const load = facts.load;
  const carrying =
    load && load.count > 0
      ? load.rank === 1 && load.teamSize > 1
        ? `, carrying the heaviest load on the team — ${pluralise(load.count, "milestone")}`
        : `, against ${pluralise(load.count, "milestone")}`
      : "";

  sentences.push(
    voice === "second"
      ? `Your score of ${formatScore(facts.score)} places you in the ${band} band${movement}${carrying}.`
      : `${s.possessive} score of ${formatScore(facts.score)} sits in the ${band} band${movement}${carrying}.`,
  );

  // 3 — availability. Past tense, so it needs no verb agreement.
  const attendance = facts.attendance;
  if (attendance && attendance.checksTotal > 0) {
    sentences.push(
      attendance.checksPassed === attendance.checksTotal
        ? `${s.they} answered all ${pluralise(attendance.checksTotal, "availability check")} ${facts.periodPhrase}.`
        : `${s.they} passed ${attendance.checksPassed} of ${attendance.checksTotal} availability checks ${facts.periodPhrase}.`,
    );
  }

  // 4 — only when there is something to act on. Delivery and attendance are
  // kept apart: the trouble area is a module name, and tacking it onto "2
  // absent days" would blame a service for somebody's absence.
  const delivery: string[] = [];
  if (facts.missedCount > 0) delivery.push(`${pluralise(facts.missedCount, "missed deadline")}`);
  if (facts.lateCount > 0) delivery.push(`${pluralise(facts.lateCount, "late delivery")}`);
  if (facts.rejectedCount > 0) delivery.push(`${pluralise(facts.rejectedCount, "rejection")}`);

  const presence: string[] = [];
  if (attendance && attendance.daysAbsent > 0) {
    presence.push(`${pluralise(attendance.daysAbsent, "absent day")}`);
  }
  if (attendance && attendance.daysLate > 0) {
    presence.push(`${pluralise(attendance.daysLate, "late start")}`);
  }

  if (delivery.length > 0) {
    const where = facts.troubleArea ? ` in ${facts.troubleArea}` : "";
    sentences.push(`Watch out: ${joinList(delivery)}${where}.`);
  }

  if (presence.length > 0) {
    sentences.push(`Also on the record: ${joinList(presence)}.`);
  } else if (delivery.length === 0 && facts.completedTotal > 0) {
    sentences.push(
      voice === "second"
        ? "Nothing slipped — keep it there."
        : "Nothing slipped this period.",
    );
  }

  return sentences.join(" ");
}

export type ClientNarrativeFacts = {
  clientName: string;
  projectTitle: string | null;
  completedThisPeriod: number;
  completionPercent: number;
  plannedNext: number;
  overdueCount: number;
};

export function narrateClientReport(facts: ClientNarrativeFacts): string {
  const sentences: string[] = [];

  if (!facts.projectTitle) {
    return `${facts.clientName} had no active engagement this week.`;
  }

  sentences.push(
    facts.completedThisPeriod === 0
      ? `No milestones were completed for ${facts.clientName} this week; ${facts.projectTitle} stands at ${facts.completionPercent}% complete.`
      : `${capitalise(pluralise(facts.completedThisPeriod, "milestone"))} ${facts.completedThisPeriod === 1 ? "was" : "were"} completed for ${facts.clientName} this week, taking ${facts.projectTitle} to ${facts.completionPercent}% complete.`,
  );

  sentences.push(
    facts.plannedNext === 0
      ? "Nothing is scheduled for next week."
      : `${capitalise(pluralise(facts.plannedNext, "item"))} ${facts.plannedNext === 1 ? "is" : "are"} scheduled for next week.`,
  );

  if (facts.overdueCount > 0) {
    sentences.push(
      `${capitalise(pluralise(facts.overdueCount, "item"))} ${facts.overdueCount === 1 ? "is" : "are"} overdue and ${facts.overdueCount === 1 ? "needs" : "need"} attention.`,
    );
  }

  return sentences.join(" ");
}

/** Scores are whole numbers unless a half-point adjustment landed. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  const value = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${value} point${Math.abs(rounded) === 1 ? "" : "s"}`;
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
