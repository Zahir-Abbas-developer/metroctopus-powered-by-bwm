import { assignableMembers, type AssignableMember } from "@/lib/assignment";
import { getSettings } from "@/lib/settings";

/**
 * Routing a new record to the person who should do it.
 *
 * The problem this solves: until now, a record with no assignee fell to whoever
 * created it. That is a safe default and a bad one — the person entering a
 * Shopify job is usually the person who answered the phone, not the person who
 * builds Shopify stores, so every unassigned record accumulated on the front
 * desk and had to be re-routed by hand.
 *
 * Three outcomes, and they are reported rather than blended, because "we knew
 * who" and "we guessed" must not look the same in the audit trail:
 *
 * - `SKILL`    — somebody's skills or job title named this work. The record goes
 *                to the best match, with the matched terms as the reason.
 * - `BALANCED` — nobody's skills named it, so it goes to the member of that
 *                department carrying the least open work. Still better than the
 *                creator: it is at least a decision about capacity.
 * - `NONE`     — the department has no assignable members, or auto-assignment is
 *                switched off. The caller keeps its own fallback.
 *
 * Ranking itself lives in `lib/assignment.ts` and is shared with the picker, so
 * the person the form recommends and the person the server picks can never
 * disagree.
 */

export type AutoAssignStrategy = "SKILL" | "BALANCED" | "NONE";

export type AutoAssignment = {
  /** Null when nothing could be decided; the caller falls back. */
  userId: string | null;
  name: string | null;
  strategy: AutoAssignStrategy;
  /** Why this person — matched skills first, then job-title terms. */
  reason: string;
  matchedTerms: string[];
};

const UNDECIDED: AutoAssignment = {
  userId: null,
  name: null,
  strategy: "NONE",
  reason: "No assignable member in this department",
  matchedTerms: [],
};

/**
 * Pick an assignee for a record in this department.
 *
 * `signals` is everything the caller knows about the work in free text — the
 * services asked for, the answers to the department's own questions, the note
 * somebody typed. Order and phrasing do not matter; `lib/matching.ts` reduces
 * all of it to comparable terms.
 *
 * Never throws. A routing decision failing must not fail the creation that
 * triggered it, so an error here returns `UNDECIDED` and the caller's existing
 * fallback stands.
 */
export async function autoAssign(
  departmentId: string,
  signals: readonly (string | null | undefined)[],
): Promise<AutoAssignment> {
  try {
    const settings = await getSettings();
    if (!settings.autoAssignEnabled) {
      return { ...UNDECIDED, reason: "Auto-assignment is switched off in settings" };
    }

    const terms = signals.filter((value): value is string => Boolean(value && value.trim()));
    const candidates = await assignableMembers(departmentId, terms);
    if (candidates.length === 0) return UNDECIDED;

    // `assignableMembers` already sorted: best match first, then lightest load.
    const best = candidates[0]!;

    /* `recommended` rather than position: `assignableMembers` always returns
       somebody first, and a member who merely sorted to the top because the
       department was quiet has not been matched to anything. Claiming SKILL
       there would put a reason on the record that is not true. */
    if (best.recommended) {
      const matchedTerms = [...best.matchedSkills, ...best.matchedTitleTerms];
      return {
        userId: best.userId,
        name: best.name,
        strategy: "SKILL",
        reason: describeSkillMatch(best),
        matchedTerms,
      };
    }

    return {
      userId: best.userId,
      name: best.name,
      strategy: "BALANCED",
      reason: describeBalance(best),
      matchedTerms: [],
    };
  } catch (error) {
    console.error("auto-assign failed", error);
    return { ...UNDECIDED, reason: "Auto-assignment could not run" };
  }
}

/**
 * Why the skills route chose this person, in words a human would use.
 *
 * Skills are quoted before the job title because a skill was set deliberately
 * for this department, while a title is a general label — and the difference
 * matters to whoever reads the record later and wonders why it landed here.
 */
function describeSkillMatch(member: AssignableMember): string {
  if (member.matchedSkills.length > 0) {
    return `Skills match: ${member.matchedSkills.join(", ")}`;
  }
  return `Job title match: ${member.jobTitle}`;
}

function describeBalance(member: AssignableMember): string {
  const load = member.openLeads + member.openTasks;
  return load === 0
    ? "Nobody's skills named this work — assigned to the member with nothing open"
    : `Nobody's skills named this work — assigned to the lightest workload (${load} open)`;
}

/**
 * The signals a lead carries, as the routing engine wants them.
 *
 * Kept here rather than at the call site so a lead created through the wizard,
 * through the API and through any future import all describe themselves the
 * same way to the router.
 *
 * `businessName` is deliberately absent: a company called "Shopify Logistics"
 * is not a Shopify job, and a prospect's own name is the one field guaranteed
 * to be full of words that look like skills.
 */
export function leadSignals(input: {
  interestedServices?: readonly string[];
  fieldValues?: Record<string, string>;
  notes?: string | null;
  source?: string | null;
}): string[] {
  return [
    ...(input.interestedServices ?? []),
    ...Object.values(input.fieldValues ?? {}).filter(Boolean),
    input.notes ?? "",
  ]
    .filter(Boolean)
    .slice(0, 24);
}

/** The signals a task carries. Its title and note are the whole description. */
export function taskSignals(input: {
  title: string;
  note?: string | null;
}): string[] {
  return [input.title, input.note ?? ""].filter(Boolean);
}
