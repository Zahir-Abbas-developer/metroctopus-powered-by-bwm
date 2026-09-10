import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { fieldsFor, valuesFor } from "@/lib/fields";
import { getSettings } from "@/lib/settings";
import { applyEvents } from "@/lib/score-service";
import { isModuleEnabled } from "@/lib/modules";
import {
  ADMIN_ROLES,
  TERMINAL_STAGE_KINDS,
  WINNING_STAGE_KINDS,
  type StageKind,
} from "@/lib/constants";

/**
 * Pipeline stages, and what happens when a record moves between them.
 *
 * Stages are per-department admin-editable records (Doctrine 3). Nothing here
 * string-matches "WON" or "LOST": a department may rename its stages, so the
 * meaning lives in `kind` and the key is only an identifier.
 */

export type StageView = {
  id: string;
  key: string;
  label: string;
  kind: StageKind;
  colorToken: string | null;
  sortOrder: number;
  isActive: boolean;
};

function toStageView(row: {
  id: string;
  key: string;
  label: string;
  kind: string;
  colorToken: string | null;
  sortOrder: number;
  isActive: boolean;
}): StageView {
  return { ...row, kind: row.kind as StageKind };
}

export async function stagesFor(
  departmentId: string,
  includeInactive = false,
): Promise<StageView[]> {
  const rows = await prisma.pipelineStage.findMany({
    where: { departmentId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map(toStageView);
}

/** The stage a new record opens at — the first OPEN one this department has. */
export function openingStage(stages: readonly StageView[]): StageView | null {
  return stages.find((stage) => stage.kind === "OPEN") ?? stages[0] ?? null;
}

export function isTerminal(kind: StageKind): boolean {
  return TERMINAL_STAGE_KINDS.includes(kind);
}

export function isWinning(kind: StageKind): boolean {
  return WINNING_STAGE_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// Moving a record
// ---------------------------------------------------------------------------

export type StageMoveResult =
  | { ok: true; stage: StageView; converted: boolean }
  | { ok: false; error: string; field?: string; status: number };

/**
 * Move a lead to another stage in its own department's pipeline.
 *
 * Everything a move implies happens here rather than at the call sites, because
 * a drag on the board, an edit in the drawer and a scripted change are the same
 * event and must not diverge:
 *
 * - the target stage must belong to *this lead's* department
 * - a LOST stage requires a reason — a deal that died for no recorded reason
 *   teaches the pipeline nothing
 * - reaching a winning stage flips the lifecycle and notifies
 * - the move logs its own activity, so the timeline shows who moved what, when
 */
export async function moveLeadStage(options: {
  leadId: string;
  toStageKey: string;
  actorId: string;
  lostReason?: string | null;
  lostNote?: string | null;
}): Promise<StageMoveResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: options.leadId },
    select: {
      id: true,
      departmentId: true,
      stage: true,
      businessName: true,
      ownerId: true,
      dealValue: true,
      convertedAt: true,
      department: { select: { shortLabel: true } },
    },
  });
  if (!lead) return { ok: false, error: "That lead no longer exists", status: 404 };

  const stages = await stagesFor(lead.departmentId);
  const target = stages.find((stage) => stage.key === options.toStageKey);
  if (!target) {
    return {
      ok: false,
      error: "That stage isn't in this department's pipeline",
      field: "stage",
      status: 422,
    };
  }

  if (target.key === lead.stage) {
    return { ok: true, stage: target, converted: false };
  }

  if (target.kind === "LOST" && !options.lostReason) {
    return {
      ok: false,
      error: "Marking a deal lost needs a reason",
      field: "lostReason",
      status: 422,
    };
  }

  const from = stages.find((stage) => stage.key === lead.stage);
  const now = new Date();
  const winning = isWinning(target.kind);

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage: target.key,
      stageChangedAt: now,
      // Clear a previous loss when a deal comes back to life, so a reopened
      // card does not carry the reason it died last time.
      lostReason: target.kind === "LOST" ? (options.lostReason ?? null) : null,
      lostNote: target.kind === "LOST" ? (options.lostNote ?? null) : null,
      // `convertedAt` is what marks the deal as having crossed the line; the
      // client record itself is created by the onboarding wizard, which needs
      // more than a stage move can supply.
      ...(winning && !lead.convertedAt ? { convertedAt: now } : {}),
    },
  });

  await prisma.salesActivity.create({
    data: {
      departmentId: lead.departmentId,
      leadId: lead.id,
      userId: options.actorId,
      type: "STATUS_CHANGE",
      isSystem: true,
      note:
        `${from?.label ?? lead.stage} → ${target.label}` +
        (target.kind === "LOST" && options.lostReason ? ` (${options.lostReason})` : ""),
      occurredAt: now,
    },
  });

  if (winning) {
    await awardWonDeal(lead, options.actorId, now);
    await notifyOutcome(lead, target, options.actorId);
  } else if (target.kind === "LOST") {
    await notifyOutcome(lead, target, options.actorId, options.lostReason ?? null);
  }

  return { ok: true, stage: target, converted: winning && !lead.convertedAt };
}

/**
 * The won-deal bonus.
 *
 * Gated on the scoring module, which is parked: an award written while the
 * ledger is switched off would surface as an unexplained score the day somebody
 * turned it back on. Deduped per lead forever, so dragging a card in and out of
 * a winning stage cannot mint a second payout.
 *
 * Carried over from the older `moveStage`, which this function replaced. That
 * one compared `stage === "WON"` — a literal only Culture Plus has, so a Pilot
 * Cars deal reaching Completed never paid out at all.
 */
async function awardWonDeal(
  lead: { id: string; businessName: string; ownerId: string | null; dealValue: number },
  actorId: string,
  at: Date,
) {
  if (!lead.ownerId) return;
  if (!(await isModuleEnabled("scoring"))) return;

  const settings = await getSettings();

  await applyEvents(
    [
      {
        userId: lead.ownerId,
        milestoneId: null,
        type: "DEAL_WON",
        points: Math.abs(settings.bonusDealWon),
        reason: `Closed ${lead.businessName}${
          lead.dealValue > 0 ? ` — $${lead.dealValue.toLocaleString("en-US")}` : ""
        }.`,
        dedupeKey: `lead:${lead.id}:WON`,
      },
    ],
    { at, createdById: actorId },
  );
}

/**
 * Tell the assignee and every admin how a deal ended.
 *
 * The actor is skipped: they just did it, and a notification telling someone
 * what they themselves have this second done is noise that trains people to
 * ignore the bell.
 */
async function notifyOutcome(
  lead: {
    id: string;
    businessName: string;
    ownerId: string | null;
    dealValue: number;
    department: { shortLabel: string };
  },
  stage: StageView,
  actorId: string,
  lostReason: string | null = null,
) {
  const admins = await prisma.user.findMany({
    where: { role: { in: [...ADMIN_ROLES] }, isActive: true },
    select: { id: true },
  });

  const recipients = new Set<string>(admins.map((admin) => admin.id));
  if (lead.ownerId) recipients.add(lead.ownerId);
  recipients.delete(actorId);

  const lost = stage.kind === "LOST";

  for (const userId of recipients) {
    await notify({
      userId,
      type: lost ? "WORK_REJECTED" : "LEAD_WON",
      title: lost
        ? `${lead.businessName} was lost`
        : `${lead.businessName} reached ${stage.label}`,
      body: lost
        ? `${lead.department.shortLabel}${lostReason ? ` — ${lostReason}` : ""}`
        : `${lead.department.shortLabel}` +
          (lead.dealValue > 0 ? ` — ${lead.dealValue.toLocaleString()}` : ""),
      href: `/pipeline?lead=${lead.id}`,
      // One notification per lead per stage, however many times a card is
      // dragged back and forth across the line.
      dedupeKey: `lead-outcome:${lead.id}:${stage.key}:${userId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type CommissionRow = {
  leadId: string;
  businessName: string;
  stageLabel: string;
  dealValue: number;
  ratePercent: number;
  amount: number;
  ownerName: string | null;
  wonAt: Date | null;
};

/**
 * Commission owed on this department's won partners.
 *
 * Derived on read rather than stored: the rate lives in a `commission_rate`
 * field definition an admin can edit, and the deal value can be corrected after
 * the fact. A stored amount would silently disagree with both the moment either
 * changed, and nothing would say which figure was right.
 *
 * Returns an empty list for a department with no `commission_rate` field, which
 * is every department except Affiliates today — and is a data question, not a
 * hardcoded one.
 */
export async function commissionsFor(departmentId: string): Promise<CommissionRow[]> {
  const definitions = await fieldsFor(departmentId, "LEAD");
  const rate = definitions.find((definition) => definition.key === "commission_rate");
  if (!rate) return [];

  const stages = await stagesFor(departmentId);
  const winningKeys = stages
    .filter((stage) => isWinning(stage.kind))
    .map((stage) => stage.key);
  if (winningKeys.length === 0) return [];

  const leads = await prisma.lead.findMany({
    where: { departmentId, stage: { in: winningKeys } },
    orderBy: { stageChangedAt: "desc" },
    select: {
      id: true,
      businessName: true,
      stage: true,
      dealValue: true,
      convertedAt: true,
      owner: { select: { name: true } },
    },
  });

  const rows: CommissionRow[] = [];
  for (const lead of leads) {
    const values = await valuesFor(lead.id, [rate]);
    const ratePercent = Number(values[rate.key] ?? "");
    if (!Number.isFinite(ratePercent) || ratePercent <= 0) continue;

    rows.push({
      leadId: lead.id,
      businessName: lead.businessName,
      stageLabel: stages.find((stage) => stage.key === lead.stage)?.label ?? lead.stage,
      dealValue: lead.dealValue,
      ratePercent,
      // Rounded to whole currency units, matching every other money column.
      amount: Math.round((lead.dealValue * ratePercent) / 100),
      ownerName: lead.owner?.name ?? null,
      wonAt: lead.convertedAt,
    });
  }

  return rows;
}
