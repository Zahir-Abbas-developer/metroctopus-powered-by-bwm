/**
 * T3 — one full journey per department, over HTTP.
 *
 * The phase's exit criteria are journeys, not screens: a Pilot Cars inquiry
 * reaching Completed with a quote, an insurance lead reaching Active Client, an
 * affiliate reaching Active with commission computed on the won value, a
 * Culture Plus lead reaching Won. Each is driven here through the same
 * endpoints the board uses, so what is proven is the behaviour and not a
 * component's idea of it.
 *
 * Run against a live server: `npm run journeytest`.
 *
 * Clears `mustChangePassword` on the accounts it signs in as, for the same
 * reason permtest and leak-scan do: the app shell redirects to the change
 * password screen before any surface renders, and a suite that receives that
 * screen for every request passes while checking nothing.
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "bwm-change-me";
const ADMIN = "coachd@bwm.local";
const MEMBER = "tayyaba@bwm.local";

let failures = 0;
let checks = 0;

function check(ok, label, detail = "") {
  checks += 1;
  if (ok) return true;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

/** The journey each department is driven through, by stage key. */
const JOURNEYS = {
  "pilot-cars": ["QUALIFIED", "QUOTE", "SCHEDULED", "DISPATCHED", "COMPLETED"],
  "life-health-insurance": ["QUALIFIED", "CONTACTED", "PROPOSAL", "CONVERTED", "ACTIVE_CLIENT"],
  affiliates: ["QUALIFIED", "ONBOARDING", "ACTIVE"],
  "culture-plus-network": ["QUALIFIED", "CONTACTED", "PROPOSAL", "NEGOTIATION", "WON"],
};

const DEAL_VALUE = 12_000;
/** Affiliates' commission_rate answer, as a percentage. */
const COMMISSION_RATE = "12.5";

async function main() {
  await waitForServer();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const created = [];
  const createdTasks = [];
  const createdLeads = [];

  try {
    await prisma.user.updateMany({
      where: { email: { in: [ADMIN, MEMBER] } },
      data: { mustChangePassword: false },
    });

    const admin = new Session("admin");
    await admin.signIn(ADMIN, SEED_PASSWORD);

    const departments = await prisma.department.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
    });

    for (const department of departments) {
      const journey = JOURNEYS[department.slug];
      if (!check(Boolean(journey), `${department.shortLabel}: has a journey defined`)) continue;

      const form = await (
        await admin.fetch(`/api/departments/${department.id}/form?entity=LEAD`)
      ).json();

      // Answer every required field, plus the commission rate where the
      // department defines one.
      const fieldValues = {};
      for (const field of form.fields ?? []) {
        if (field.key === "commission_rate") {
          fieldValues[field.key] = COMMISSION_RATE;
          continue;
        }
        if (!field.required) continue;
        fieldValues[field.key] =
          field.type === "SELECT" ? (field.options[0] ?? "") : `journey-${field.key}`;
      }

      const createRes = await admin.fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: department.id,
          businessName: `Journey ${department.shortLabel}`,
          contactName: "Journey Contact",
          email: "journey@bwm.local",
          source: "OUTREACH",
          dealValue: DEAL_VALUE,
          fieldValues,
        }),
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (
        !check(
          createRes.status === 201,
          `${department.shortLabel}: lead created`,
          `${createRes.status} ${JSON.stringify(createBody.fields ?? createBody.error ?? "")}`,
        )
      ) {
        continue;
      }

      const leadId = createBody.lead.id;
      created.push(leadId);

      // Walk the journey one stage at a time.
      for (const stageKey of journey) {
        const res = await admin.fetch(`/api/leads/${leadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: stageKey }),
        });
        const body = await res.json().catch(() => ({}));
        check(
          res.ok,
          `${department.shortLabel}: → ${stageKey}`,
          `${res.status} ${body.error ?? ""}`,
        );
      }

      const after = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { stage: true, convertedAt: true },
      });
      const final = journey[journey.length - 1];
      check(after?.stage === final, `${department.shortLabel}: ended at ${final}`, after?.stage);

      // A winning stage flips the lifecycle.
      check(
        after?.convertedAt !== null,
        `${department.shortLabel}: marked converted on reaching a winning stage`,
      );

      // Every move logged a system activity, so the timeline shows the path.
      const moves = await prisma.salesActivity.count({
        where: { leadId, type: "STATUS_CHANGE", isSystem: true },
      });
      check(
        moves === journey.length,
        `${department.shortLabel}: ${journey.length} stage moves logged`,
        `logged ${moves}`,
      );

      // A loss needs a reason, whatever the department calls the stage.
      const lostStage = (form.stages ?? []).find((stage) => stage.kind === "LOST");
      if (lostStage) {
        const refused = await admin.fetch(`/api/leads/${leadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: lostStage.key }),
        });
        check(
          refused.status === 422,
          `${department.shortLabel}: LOST refused without a reason`,
          `status ${refused.status}`,
        );
      }
    }

    // ------------------------------------------------------------ commission --
    const affiliates = departments.find((d) => d.slug === "affiliates");
    if (affiliates) {
      const board = await (
        await admin.fetch(`/api/pipeline?departmentId=${affiliates.id}`)
      ).json();

      const row = (board.commissions ?? []).find(
        (entry) => entry.businessName === `Journey ${affiliates.shortLabel}`,
      );
      if (check(Boolean(row), "Affiliates: commission row present")) {
        const expected = Math.round((DEAL_VALUE * Number(COMMISSION_RATE)) / 100);
        check(
          row.amount === expected,
          "Affiliates: commission computed from value × rate",
          `got ${row.amount}, expected ${expected}`,
        );
      }

      // Commission is money, so a viewer who may not see deal values gets none.
      check(
        (board.commissions ?? []).length > 0,
        "Affiliates: admin receives the commissions table",
      );
    }

    // ------------------------------------------------------------- board shape --
    for (const department of departments) {
      const board = await (
        await admin.fetch(`/api/pipeline?departmentId=${department.id}`)
      ).json();

      const stageKeys = (board.stages ?? []).map((s) => s.key);
      check(
        stageKeys.length > 0,
        `${department.shortLabel}: board has columns`,
      );
      check(
        (board.leads ?? []).every((lead) => stageKeys.includes(lead.stage)),
        `${department.shortLabel}: every lead sits on one of its own stages`,
      );
      check(
        (board.totals ?? []).length === stageKeys.length,
        `${department.shortLabel}: a total per column`,
      );
    }

    // ------------------------------------------------------- tasks & follow-ups --
    const firstDept = departments[0];

    /**
     * Today on the *company* clock, as YYYY-MM-DD.
     *
     * Not `new Date().toISOString().slice(0, 10)`. That is today in UTC, and
     * for a zone behind UTC the two disagree for several hours every evening —
     * so a task "due today" would be filed against tomorrow's date and land in
     * Upcoming, which is what the first run of this suite did.
     *
     * Date-only values are stored at UTC midnight of the intended calendar day
     * (see lib/date.ts), so the string is what matters, not the instant.
     */
    const boardMeta = await (await admin.fetch("/api/tasks?mine=1")).json();
    const companyToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: boardMeta.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    check(Boolean(boardMeta.timeZone), "the board reports the company timezone");

    const taskRes = await admin.fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departmentId: firstDept.id,
        title: "Journey task — call back",
        dueAt: companyToday,
        priority: "HIGH",
      }),
    });
    const taskBody = await taskRes.json().catch(() => ({}));
    const taskOk = check(
      taskRes.status === 201,
      "task created",
      `${taskRes.status} ${JSON.stringify(taskBody.fields ?? taskBody.error ?? "")}`,
    );

    if (taskOk) {
      const taskId = taskBody.task.id;
      createdTasks.push(taskId);

      const board = await (await admin.fetch("/api/tasks?mine=1")).json();
      const row = (board.tasks ?? []).find((entry) => entry.id === taskId);
      check(Boolean(row), "task appears on the board");
      check(row?.bucket === "TODAY", "a task due today lands in Today", row?.bucket);

      const done = await admin.fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      check(done.ok, "task completed", String(done.status));

      const after = await (await admin.fetch("/api/tasks?mine=1")).json();
      const completedRow = (after.tasks ?? []).find((entry) => entry.id === taskId);
      check(completedRow?.bucket === "COMPLETED", "completed task moves to Completed");
    }

    // A follow-up surfaces from the record itself, never a copied task row.
    const followLead = await prisma.lead.create({
      data: {
        departmentId: firstDept.id,
        businessName: "Journey Follow-up",
        contactName: "Journey Contact",
        stage: (await prisma.pipelineStage.findFirst({
          where: { departmentId: firstDept.id, kind: "OPEN" },
          orderBy: { sortOrder: "asc" },
        }))?.key ?? "NEW_INQUIRY",
        ownerId: (await prisma.user.findUnique({ where: { email: ADMIN } })).id,
        nextFollowUpAt: new Date(`${companyToday}T00:00:00.000Z`),
      },
    });
    createdLeads.push(followLead.id);

    const withFollowUp = await (await admin.fetch("/api/tasks?mine=1")).json();
    const projected = (withFollowUp.tasks ?? []).find(
      (entry) => entry.kind === "FOLLOW_UP" && entry.record?.id === followLead.id,
    );
    check(Boolean(projected), "a due follow-up surfaces on the board");
    check(
      projected?.bucket === "TODAY" || projected?.bucket === "OVERDUE",
      "a due follow-up is Today or Overdue",
      projected?.bucket,
    );

    // Logging an outcome without a next date, and without closing out, is
    // refused — the whole point of the feature.
    const silent = await admin.fetch("/api/follow-ups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "LEAD",
        recordId: followLead.id,
        action: "log",
        activityType: "CALL",
        note: "Spoke briefly",
      }),
    });
    check(
      silent.status === 422,
      "logging an outcome with no next date is refused",
      `status ${silent.status}`,
    );

    const logged = await admin.fetch("/api/follow-ups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "LEAD",
        recordId: followLead.id,
        action: "log",
        activityType: "CALL",
        note: "Spoke to ops, revised quote Thursday",
        nextFollowUpAt: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      }),
    });
    check(logged.ok, "logging an outcome with a next date succeeds", String(logged.status));

    const activityLogged = await prisma.salesActivity.count({
      where: { leadId: followLead.id, type: "CALL" },
    });
    check(activityLogged === 1, "the outcome was written to the timeline");

    const snoozed = await admin.fetch("/api/follow-ups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "LEAD",
        recordId: followLead.id,
        action: "snooze",
        days: 3,
      }),
    });
    check(snoozed.ok, "a follow-up can be snoozed", String(snoozed.status));

    // ---------------------------------------------------------------- scoping --
    const member = new Session("member");
    await member.signIn(MEMBER, SEED_PASSWORD);

    const mine = await prisma.departmentMembership.findMany({
      where: { user: { email: MEMBER } },
      select: { departmentId: true },
    });
    const allowed = new Set(mine.map((m) => m.departmentId));
    const forbidden = departments.find((d) => !allowed.has(d.id));

    if (forbidden) {
      const blocked = await member.fetch(`/api/pipeline?departmentId=${forbidden.id}`);
      check(
        blocked.status === 403,
        `${forbidden.shortLabel}: board refused to a non-member`,
        `status ${blocked.status}`,
      );
    }

    console.log(`\n${checks} checks`);
    if (failures === 0) {
      console.log("\n✓ every department ran its journey end to end\n");
    } else {
      console.error(`\n✗ ${failures} of ${checks} checks failed\n`);
      process.exitCode = 1;
    }
  } finally {
    // Leave the database as it was found.
    for (const id of createdTasks) {
      await prisma.task.delete({ where: { id } }).catch(() => {});
    }
    for (const id of [...created, ...createdLeads]) {
      await prisma.task.deleteMany({ where: { leadId: id } });
      await prisma.salesActivity.deleteMany({ where: { leadId: id } });
      await prisma.fieldValue.deleteMany({ where: { recordId: id } });
      await prisma.lead.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
