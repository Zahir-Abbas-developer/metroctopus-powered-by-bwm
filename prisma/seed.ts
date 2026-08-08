import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor } from "../lib/constants";
import { planFor, defaultAssigneeFor } from "../lib/templates";
import { addDays, dueDeadline, agencyYearMonth, toDateOnly, formatDate } from "../lib/date";
import { generateReports } from "../lib/reports";
import { notify } from "../lib/notifications";
import { mentionedUserIds } from "../lib/mentions";
import { evaluateCompletion, evaluateMissed, rejectionEvent } from "../lib/scoring";
import { checkRoasAlert } from "../lib/kpi-service";
import {
  formatKarachiClock,
  karachiDay,
  karachiInstant,
  karachiWeekday,
} from "../lib/attendance-time";

const prisma = new PrismaClient();

const ADMIN_PASSWORD = "admin123";
const MEMBER_PASSWORD = "member123";

/**
 * The real team.
 *
 * Addresses follow first-name@agency.local so the demo is self-consistent;
 * swap them for real mailboxes before anyone relies on the welcome email.
 * The owner keeps admin@agency.local so the documented sign-in still works.
 */
const TEAM = [
  {
    name: "Subtain",
    email: "subtain@agency.local",
    jobTitle: "Performance Marketer",
  },
  {
    name: "Saad Tariq",
    email: "saad@agency.local",
    jobTitle: "Business Developer",
  },
  {
    name: "Shahnawaz",
    email: "shahnawaz@agency.local",
    jobTitle: "Shopify Designer · AI Websites · Product Hunting",
  },
  {
    name: "Shahzaib",
    email: "shahzaib@agency.local",
    jobTitle: "Ecommerce Marketplaces · Sourcing · AI SEO",
  },
];

const ADMIN = {
  name: "Raja Zain",
  email: "admin@agency.local",
  jobTitle: "Founder · Client Acquisition & Scaling",
};

/** The agency's offerings. `slug` keys the planning templates and never changes. */
const SERVICES = [
  {
    slug: "shopify-design-development",
    name: "Shopify Design & Development",
    description: "Store design, theme build, migrations, speed and launch.",
    order: 1,
  },
  {
    slug: "google-ads-management",
    name: "Google Ads Management",
    description: "Search, Shopping and Performance Max, tracked end to end.",
    order: 2,
  },
  {
    slug: "meta-ads-management",
    name: "Meta Ads Management",
    description: "Facebook and Instagram prospecting and retargeting.",
    order: 3,
  },
  {
    slug: "creative-research-design",
    name: "Creative Research & Design",
    description: "Angle research, concepts and production-ready ad creative.",
    order: 4,
  },
  {
    slug: "full-funnel",
    name: "Full Funnel (Website → Ads → Sales)",
    description: "Everything from the storefront through to closed sales.",
    order: 5,
  },
];

/** Sample book of business, so the app has something real to show. */
const CLIENTS = [
  {
    businessName: "Lumen Skincare",
    contactName: "Sara Malik",
    email: "sara@lumenskin.co",
    phone: "+92 300 1234567",
    country: "Pakistan",
    industry: "Beauty & Skincare",
    monthlyBudget: 4500,
    status: "ACTIVE",
    notes:
      "Wants aggressive scaling before Eid. Creative fatigue is the main bottleneck — batch deliveries matter more than volume.",
    services: ["meta-ads-management", "creative-research-design"],
    /** Days ago the engagement started, so the sample data spans real states. */
    startedDaysAgo: 24,
  },
  {
    businessName: "Northline Outdoors",
    contactName: "James Whitfield",
    email: "james@northlineoutdoors.com",
    phone: "+44 7700 900123",
    country: "United Kingdom",
    industry: "Sports & Fitness",
    monthlyBudget: 7200,
    status: "ACTIVE",
    notes: "Migrating from WooCommerce. Peak season starts in October — launch cannot slip.",
    services: ["shopify-design-development", "google-ads-management"],
    startedDaysAgo: 12,
  },
  {
    businessName: "Maison Rue",
    contactName: "Claire Dubois",
    email: "claire@maisonrue.fr",
    country: "France",
    industry: "Apparel & Fashion",
    monthlyBudget: 9800,
    status: "ACTIVE",
    notes: "Full funnel retainer. Reports go to the founder every Friday without fail.",
    services: ["full-funnel", "meta-ads-management", "creative-research-design"],
    startedDaysAgo: 3,
  },
  {
    businessName: "Copper & Oak",
    contactName: "Daniel Reyes",
    email: "dan@copperandoak.com",
    country: "United States",
    industry: "Home & Furniture",
    monthlyBudget: 3000,
    status: "PAUSED",
    notes: "Paused while they clear a warehouse backlog. Expected back next quarter.",
    services: ["google-ads-management"],
    startedDaysAgo: 46,
  },
  {
    businessName: "Verdant Pet Co.",
    contactName: "Nadia Iqbal",
    email: "nadia@verdantpet.co",
    country: "United Arab Emirates",
    industry: "Pet Products",
    monthlyBudget: 2500,
    status: "LEAD",
    notes: "Discovery call done. Waiting on their product feed before we scope anything.",
    services: [],
    startedDaysAgo: null,
  },
];

async function main() {
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 10);

  // --- People -------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: {
      name: ADMIN.name,
      passwordHash: adminHash,
      role: "ADMIN",
      jobTitle: ADMIN.jobTitle,
      avatarColor: avatarColorFor(ADMIN.email),
      isActive: true,
    },
    create: {
      ...ADMIN,
      passwordHash: adminHash,
      role: "ADMIN",
      avatarColor: avatarColorFor(ADMIN.email),
      isActive: true,
    },
  });

  for (const member of TEAM) {
    await prisma.user.upsert({
      where: { email: member.email },
      update: {
        name: member.name,
        passwordHash: memberHash,
        role: "MEMBER",
        jobTitle: member.jobTitle,
        avatarColor: avatarColorFor(member.email),
        isActive: true,
      },
      create: {
        ...member,
        passwordHash: memberHash,
        role: "MEMBER",
        avatarColor: avatarColorFor(member.email),
        isActive: true,
      },
    });
  }

  // Anyone not on the roster above is left over from an earlier seed. This is
  // the demo seed and it is destructive by design — production uses
  // prisma/seed-admin.ts, which only ever upserts the owner. Without this,
  // "replacing the team" would leave the previous sample accounts able to sign
  // in alongside the real one.
  const roster = [ADMIN.email, ...TEAM.map((member) => member.email)];
  const removed = await prisma.user.deleteMany({
    where: { email: { notIn: roster } },
  });
  if (removed.count > 0) {
    console.log(`  removed ${removed.count} account(s) not on the current roster`);
  }

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true, jobTitle: true },
  });

  // --- Service catalogue --------------------------------------------------
  for (const service of SERVICES) {
    await prisma.serviceCatalog.upsert({
      where: { slug: service.slug },
      update: { name: service.name, description: service.description, order: service.order },
      create: { ...service, isActive: true },
    });
  }

  const services = await prisma.serviceCatalog.findMany();
  const serviceBySlug = new Map(services.map((service) => [service.slug, service]));

  // --- Clients, projects, modules, milestones -----------------------------
  //
  // Sample data is rebuilt from scratch each run. Users and the catalogue are
  // upserted (they're referenced by real sessions), but engagements are
  // regenerated so the demo always shows a coherent spread of states.
  await prisma.client.deleteMany({});

  let projectCount = 0;
  let milestoneCount = 0;
  const now = new Date();

  for (const sample of CLIENTS) {
    const client = await prisma.client.create({
      data: {
        businessName: sample.businessName,
        contactName: sample.contactName,
        email: sample.email,
        phone: sample.phone,
        country: sample.country,
        industry: sample.industry,
        monthlyBudget: sample.monthlyBudget,
        status: sample.status,
        notes: sample.notes,
        onboardedAt:
          sample.startedDaysAgo === null
            ? now
            : addDays(now, -sample.startedDaysAgo - 4),
      },
    });

    if (sample.startedDaysAgo === null || sample.services.length === 0) continue;

    const startDate = toDateOnly(addDays(now, -sample.startedDaysAgo));
    const endDate = toDateOnly(addDays(startDate, 30));
    const serviceIds = sample.services
      .map((slug) => serviceBySlug.get(slug)?.id)
      .filter((id): id is string => Boolean(id));

    const project = await prisma.project.create({
      data: {
        clientId: client.id,
        title: `${monthLabel(startDate)} Retainer`,
        startDate,
        endDate,
        status: endDate < now ? "OVERDUE_CLOSEOUT" : "ACTIVE",
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    projectCount += 1;

    const plan = planFor(sample.services);
    for (const [moduleIndex, entry] of plan.entries()) {
      const assigneeId = defaultAssigneeFor(entry.slug, members);

      const createdModule = await prisma.module.create({
        data: {
          projectId: project.id,
          name: entry.module.name,
          serviceId: entry.slug ? (serviceBySlug.get(entry.slug)?.id ?? null) : null,
          order: moduleIndex,
        },
      });

      for (const [index, template] of entry.module.milestones.entries()) {
        const dueDate = toDateOnly(addDays(startDate, template.dayOffset));
        // Weekly reports go to the account's funnel owner in the sample data.
        const owner =
          assigneeId ?? defaultAssigneeFor("full-funnel", members) ?? members[0]?.id ?? null;

        await prisma.milestone.create({
          data: {
            moduleId: createdModule.id,
            title: template.title,
            description: template.description,
            weight: template.weight,
            dueDate,
            order: index,
            assigneeId: owner,
            ...sampleProgress(dueDate, now),
          },
        });
        milestoneCount += 1;
      }
    }
  }

  const scoreEvents = await backfillScoreEvents(admin.id);
  // After the backfill: it clears the ledger, and attendance writes into it.
  const attendance = await seedAttendance();
  const fairness = await seedFairness(admin.id);
  const growth = await seedGrowth(admin.id, members);
  const outcomes = await seedOutcomes();
  const { reports, notifications } = await seedReportsAndNotifications();
  const collab = await seedCollaboration(admin.id);

  print({
    projectCount,
    milestoneCount,
    scoreEvents: scoreEvents + attendance.scoreEvents,
    reports,
    notifications,
    attendanceDays: attendance.attendanceDays,
    availabilityChecks: attendance.availabilityChecks,
    leaveRequests: attendance.leaveRequests,
    ...fairness,
    ...growth,
    ...outcomes,
    ...collab,
  });
}

/**
 * Four weeks of attendance history.
 *
 * Deterministic rather than random: the same seed run produces the same past
 * every time, so a screenshot taken today still matches the data tomorrow. The
 * pattern per member comes from a stable hash of their id, which gives each
 * person a different-looking month without anyone's being invented twice.
 *
 * Score events are written with production's dedupe keys, so a later
 * evaluation run recognises them and cannot charge the same day again.
 */
async function seedAttendance() {
  await prisma.availabilityCheck.deleteMany({});
  await prisma.attendanceDay.deleteMany({});
  await prisma.leaveRequest.deleteMany({});

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  const workdays = settings.workdays
    .split(",")
    .map((day) => Number(day.trim()))
    .filter(Boolean);

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const today = karachiDay(now);

  let days = 0;
  let checks = 0;
  let scoreEvents = 0;
  let leave = 0;

  for (const [memberIndex, member] of members.entries()) {
    const seed = hash(member.id);

    // One approved day off in the recent past, one request still waiting.
    const approvedLeaveDay = addDays(today, -(6 + memberIndex));
    const pendingLeaveDay = addDays(today, 4 + memberIndex);

    await prisma.leaveRequest.create({
      data: {
        userId: member.id,
        date: approvedLeaveDay,
        reason: "Family commitment — arranged cover with the team.",
        status: "APPROVED",
        reviewedAt: addDays(approvedLeaveDay, -2),
      },
    });
    // Only the first two members have something outstanding; an inbox where
    // every single person is waiting on a decision isn't a realistic demo.
    if (memberIndex < 2) {
      await prisma.leaveRequest.create({
        data: {
          userId: member.id,
          date: pendingLeaveDay,
          reason: "Medical appointment in the afternoon.",
          status: "PENDING",
        },
      });
      leave += 1;
    }
    leave += 1;

    // Yesterday backwards, so today is left alone for the live walkthrough.
    for (let back = 1; back <= 28; back += 1) {
      const day = addDays(today, -back);
      const weekday = karachiWeekday(day);

      if (!workdays.includes(weekday)) {
        await prisma.attendanceDay.create({
          data: { userId: member.id, date: day, status: "OFF" },
        });
        days += 1;
        continue;
      }

      if (day.getTime() === approvedLeaveDay.getTime()) {
        await prisma.attendanceDay.create({
          data: { userId: member.id, date: day, status: "LEAVE" },
        });
        days += 1;
        continue;
      }

      const roll = (seed + back * 2_654_435_761) >>> 0;

      // Roughly: 1 absence a month, a late start most weeks, otherwise on time.
      const absent = roll % 29 === 3;
      const late = !absent && roll % 7 === 2;

      if (absent) {
        const record = await prisma.attendanceDay.create({
          data: { userId: member.id, date: day, status: "ABSENT" },
        });
        days += 1;

        await createAttendanceEvent({
          userId: member.id,
          type: "ABSENT_DAY",
          points: -settings.penaltyAbsentDay,
          reason: `No clock-in by ${formatKarachiClock(settings.absentCutoffMinutes)} and no approved leave.`,
          dedupeKey: `day:${record.id}:ABSENT`,
          at: karachiInstant(day, settings.absentCutoffMinutes),
        });
        scoreEvents += 1;
        continue;
      }

      const startMinutes = late
        ? settings.shiftStartMinutes + settings.graceMinutes + 5 + (roll % 40)
        : settings.clockInOpensMinutes + 15 + (roll % 25);
      const endMinutes = settings.shiftEndMinutes - (roll % 20);

      const clockInAt = karachiInstant(day, startMinutes);
      const clockOutAt = karachiInstant(day, endMinutes);

      const record = await prisma.attendanceDay.create({
        data: {
          userId: member.id,
          date: day,
          clockInAt,
          clockOutAt,
          status: late ? "LATE" : "PRESENT",
          totalMinutes: endMinutes - startMinutes,
        },
      });
      days += 1;

      if (late) {
        await createAttendanceEvent({
          userId: member.id,
          type: "LATE_CLOCK_IN",
          points: -settings.penaltyLateClockIn,
          reason: `Clocked in at ${formatKarachiClock(startMinutes)}, after the ${formatKarachiClock(
            settings.shiftStartMinutes + settings.graceMinutes,
          )} grace period.`,
          dedupeKey: `day:${record.id}:LATE_CLOCK_IN`,
          at: clockInAt,
        });
        scoreEvents += 1;
      }

      // Three checks spread across the day, kept clear of the edges.
      for (let index = 0; index < settings.checksPerDay; index += 1) {
        const spread = Math.floor(
          (endMinutes - startMinutes - 90) / Math.max(1, settings.checksPerDay),
        );
        const scheduledMinutes =
          startMinutes + 45 + index * spread + ((roll >> (index * 3)) % 25);
        const scheduledAt = karachiInstant(day, scheduledMinutes);
        const windowEndsAt = new Date(
          scheduledAt.getTime() + settings.checkWindowMinutes * 60_000,
        );

        // About one check in fourteen goes unanswered.
        const missed = ((roll >> (index * 5)) & 0xff) % 14 === 1;

        const check = await prisma.availabilityCheck.create({
          data: {
            attendanceDayId: record.id,
            scheduledAt,
            windowEndsAt,
            status: missed ? "MISSED" : "PASSED",
            respondedAt: missed
              ? null
              : new Date(scheduledAt.getTime() + (60 + (roll % 900)) * 1000),
          },
        });
        checks += 1;

        if (missed) {
          await createAttendanceEvent({
            userId: member.id,
            type: "ATTENDANCE_MISS",
            points: -settings.penaltyMissedCheck,
            reason: `Missed availability check (${formatKarachiClock(scheduledMinutes)}–${formatKarachiClock(
              scheduledMinutes + settings.checkWindowMinutes,
            )}).`,
            dedupeKey: `check:${check.id}:MISS`,
            at: windowEndsAt,
          });
          scoreEvents += 1;
        }
      }
    }
  }

  return { attendanceDays: days, availabilityChecks: checks, leaveRequests: leave, scoreEvents };
}

async function createAttendanceEvent(event: {
  userId: string;
  type: string;
  points: number;
  reason: string;
  dedupeKey: string;
  at: Date;
}) {
  const cycle = agencyYearMonth(event.at);
  await prisma.scoreEvent.create({
    data: {
      userId: event.userId,
      milestoneId: null,
      type: event.type,
      points: event.points,
      reason: event.reason,
      dedupeKey: event.dedupeKey,
      year: cycle.year,
      month: cycle.month,
      createdAt: event.at,
    },
  });
}

/**
 * The Phase 10 surfaces: quality ratings on approved work, twelve weeks of
 * client commercial numbers, and a mix of payment states.
 *
 * The KPI series is shaped rather than random. One client is comfortably above
 * target, one drifts below it over the last three weeks so the alert and the
 * at-risk list have something real to show, and one has no data at all —
 * because "no campaign data" is a state the health score has to handle and a
 * demo where every client is fully populated never exercises it.
 */
async function seedOutcomes() {
  await prisma.clientKpiEntry.deleteMany({});

  const now = new Date();
  let ratings = 0;
  let kpiWeeks = 0;
  let paidCycles = 0;

  // --- Quality ratings on approved work -------------------------------------
  const approved = await prisma.milestone.findMany({
    where: { status: "COMPLETED", assigneeId: { not: null } },
    select: { id: true, completedAt: true, dueDate: true },
  });

  for (const milestone of approved) {
    const roll = Math.abs(hash(milestone.id));
    // Mostly threes and fours — most work is simply fine, and a demo where
    // everything is five stars makes the metric look decorative.
    const rating = roll % 11 === 0 ? 2 : roll % 5 === 0 ? 5 : roll % 3 === 0 ? 3 : 4;

    await prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        qualityRating: rating,
        qualityComment:
          rating <= 2
            ? "Numbers in the report didn't reconcile with the ad account — had to be redone before it went out."
            : rating === 5
              ? "Best version of this we've sent. Client quoted it back to us."
              : null,
        qualityRatedAt: milestone.completedAt ?? milestone.dueDate,
      },
    });
    ratings += 1;
  }

  // --- Twelve weeks of client numbers ---------------------------------------
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    orderBy: { businessName: "asc" },
    select: { id: true, businessName: true, monthlyBudget: true },
  });

  const owner = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });

  const PROFILES = [
    // Performing well and steady.
    { target: 4, base: 4.4, drift: 0, sessions: 5200, aov: 96 },
    // Slipping: fine until three weeks ago, under target since. This is what
    // fires the alert and puts them on the at-risk list.
    { target: 3.5, base: 3.9, drift: -0.55, sessions: 3400, aov: 128 },
    // No data at all — the third client is deliberately left empty.
    null,
  ];

  for (const [index, client] of clients.entries()) {
    const profile = PROFILES[index % PROFILES.length];
    if (!profile) continue;

    await prisma.client.update({
      where: { id: client.id },
      data: { targetRoas: profile.target },
    });

    for (let back = 11; back >= 0; back -= 1) {
      const weekStart = karachiDay(addDays(now, -back * 7));
      // Monday of that week.
      const monday = new Date(weekStart);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));

      // The drift only applies to the last three weeks, so the chart shows a
      // healthy run and then a turn rather than a slope from day one.
      const drifting = back < 3 ? profile.drift * (3 - back) : 0;
      const wobble = ((Math.abs(hash(`${client.id}:${back}`)) % 24) - 12) / 100;
      const roas = Math.max(0.6, profile.base + drifting + wobble);

      const spend = Math.round((client.monthlyBudget / 4) * (0.85 + (back % 4) * 0.08));
      const revenue = Math.round(spend * roas);
      const orders = Math.max(1, Math.round(revenue / profile.aov));

      await prisma.clientKpiEntry.create({
        data: {
          clientId: client.id,
          weekStart: monday,
          googleSpend: Math.round(spend * 0.55),
          metaSpend: spend - Math.round(spend * 0.55),
          revenue,
          orders,
          storeSessions: profile.sessions + ((Math.abs(hash(`s:${client.id}:${back}`)) % 900) - 450),
          notes:
            back === 2 && profile.drift < 0
              ? "Creative fatigue on the top-performing set. Refresh queued."
              : null,
          enteredById: owner?.id ?? null,
        },
      });
      kpiWeeks += 1;
    }

    // Rows are written directly for speed, which skips the alert the service
    // fires on save. Run it once at the end so a seeded demo where the card
    // shows "Performance attention" also has the notification that would have
    // produced it — a chip with no notice behind it is an inconsistent demo.
    await checkRoasAlert(client.id, now);
  }

  // --- Payment states -------------------------------------------------------
  const cycles = await prisma.project.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, startDate: true },
  });

  for (const [index, cycle] of cycles.entries()) {
    // Most paid, one still pending, one left to go overdue on the next cron
    // run — so the collections card has something in it.
    const status = index === 0 ? "PENDING" : index === 1 ? "OVERDUE" : "PAID";

    await prisma.project.update({
      where: { id: cycle.id },
      data: {
        paymentStatus: status,
        paidAt: status === "PAID" ? addDays(cycle.startDate, 3) : null,
        invoiceNote: status === "OVERDUE" ? "Second reminder sent." : null,
      },
    });
    if (status === "PAID") paidCycles += 1;
  }

  return { qualityRatings: ratings, kpiWeeks, paidCycles };
}

/**
 * The Phase 9 growth surfaces: a live pipeline, weekly targets for the
 * business developer, and six months of MRR history.
 *
 * The MRR series is invented on purpose — it is the one number whose history
 * cannot be derived from today's data, so a demo without snapshots shows a
 * flat line and the trend card looks broken rather than empty.
 */
async function seedGrowth(
  adminId: string,
  members: { id: string; jobTitle: string }[],
) {
  await prisma.salesActivity.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.activityTarget.deleteMany({});
  await prisma.mrrSnapshot.deleteMany({});

  const now = new Date();

  // --- Weekly targets -------------------------------------------------------
  // Saad is the Business Developer; the owner carries a lighter closing load
  // alongside everything else they do.
  const bd = members.find((member) => member.jobTitle.includes("Business Developer"));

  const targetPlans: { userId: string; targets: [string, number][] }[] = [
    ...(bd
      ? [{
          userId: bd.id,
          targets: [["OUTREACH", 40], ["FOLLOW_UP", 8], ["PROPOSAL", 3], ["MEETING", 5]] as [string, number][],
        }]
      : []),
    {
      userId: adminId,
      targets: [["OUTREACH", 15], ["PROPOSAL", 2], ["MEETING", 4]] as [string, number][],
    },
  ];

  let targets = 0;
  for (const plan of targetPlans) {
    for (const [bucket, weeklyTarget] of plan.targets) {
      await prisma.activityTarget.create({
        data: { userId: plan.userId, bucket, weeklyTarget },
      });
      targets += 1;
    }
  }

  // --- Pipeline -------------------------------------------------------------
  const LEADS = [
    { businessName: "Harbour & Vine", contactName: "Elena Marsh", country: "United Kingdom", source: "INBOUND", stage: "NEGOTIATION", value: 6500, services: ["meta-ads-management", "creative-research-design"], days: 21, activities: 11 },
    { businessName: "Nordwell Supply", contactName: "Anders Holm", country: "Sweden", source: "OUTREACH", stage: "PROPOSAL_SENT", value: 4800, services: ["google-ads-management"], days: 9, activities: 7 },
    { businessName: "Saffron & Sage", contactName: "Priya Raman", country: "United Arab Emirates", source: "REFERRAL", stage: "MEETING_BOOKED", value: 3200, services: ["full-funnel"], days: 4, activities: 4 },
    { businessName: "Coastline Denim", contactName: "Marco Bellini", country: "Italy", source: "SOCIAL", stage: "CONTACTED", value: 2800, services: ["shopify-design-development"], days: 6, activities: 3 },
    { businessName: "Verdigris Home", contactName: "Tom Fletcher", country: "United States", source: "OUTREACH", stage: "CONTACTED", value: 5200, services: ["meta-ads-management"], days: 2, activities: 2 },
    { businessName: "Pinecrest Outdoors", contactName: "Sara Lindqvist", country: "Norway", source: "OUTREACH", stage: "NEW", value: 3900, services: ["google-ads-management", "meta-ads-management"], days: 1, activities: 0 },
    { businessName: "Atlas Athletic", contactName: "Danny Okoro", country: "United Kingdom", source: "INBOUND", stage: "NEW", value: 7400, services: ["full-funnel"], days: 0, activities: 1 },
    { businessName: "Lumière Beauté", contactName: "Camille Roux", country: "France", source: "REFERRAL", stage: "WON", value: 5600, services: ["meta-ads-management"], days: 3, activities: 9 },
    { businessName: "Ironwood Tools", contactName: "Greg Sandoval", country: "United States", source: "OUTREACH", stage: "LOST", value: 4100, services: ["google-ads-management"], days: 5, activities: 6, lostReason: "PRICE", lostNote: "Wanted the retainer at half. Walked when we held the number." },
    { businessName: "Meadowlark Kids", contactName: "Anne Dubois", country: "Canada", source: "SOCIAL", stage: "LOST", value: 2200, services: ["creative-research-design"], days: 6, activities: 4, lostReason: "NO_RESPONSE", lostNote: "Three follow-ups after the proposal, nothing back." },
  ];

  const ACTIVITY_SCRIPT = [
    ["EMAIL", "Cold intro referencing their Meta ad library — three creatives, all static."],
    ["FOLLOW_UP", "Second nudge. Opened twice, no reply yet."],
    ["CALL", "Picked up. Running everything in-house, unhappy with ROAS since May."],
    ["MEETING", "45 minutes on the funnel. Their AOV supports the retainer comfortably."],
    ["PROPOSAL_SENT", "Sent the full-funnel proposal at the number we discussed."],
    ["FOLLOW_UP", "Chased the proposal. Finance signs off Thursday."],
    ["DM", "LinkedIn nudge to the founder while the email sat unread."],
    ["CALL", "Talked through the onboarding timeline and who they'd work with."],
    ["FOLLOW_UP", "Confirmed the start date and what we need from their side."],
    ["EMAIL", "Sent the ad account access checklist."],
    ["MEETING", "Final call before signature."],
  ];

  let leadCount = 0;
  let activityCount = 0;

  for (const [index, entry] of LEADS.entries()) {
    const ownerId = bd && index % 3 !== 0 ? bd.id : adminId;
    const stageChangedAt = addDays(now, -entry.days);

    const lead = await prisma.lead.create({
      data: {
        businessName: entry.businessName,
        contactName: entry.contactName,
        email: `${entry.contactName.split(" ")[0].toLowerCase()}@${entry.businessName
          .toLowerCase()
          .replace(/[^a-z]/g, "")}.com`,
        country: entry.country,
        source: entry.source,
        stage: entry.stage,
        stageChangedAt,
        estimatedMonthlyValue: entry.value,
        interestedServices: entry.services.join(","),
        ownerId,
        lostReason: entry.lostReason ?? null,
        lostNote: entry.lostNote ?? null,
        createdAt: addDays(stageChangedAt, -(entry.activities + 3)),
      },
    });
    leadCount += 1;

    // Activity spread backwards from the stage change, so the timeline reads
    // as a conversation rather than a burst.
    for (let i = 0; i < entry.activities; i += 1) {
      const [type, note] = ACTIVITY_SCRIPT[i % ACTIVITY_SCRIPT.length];
      await prisma.salesActivity.create({
        data: {
          leadId: lead.id,
          userId: ownerId,
          type,
          note,
          occurredAt: addDays(stageChangedAt, -(entry.activities - i) * 1.4),
        },
      });
      activityCount += 1;
    }
  }

  // This week's activity, so the target bar shows a week in progress rather
  // than a flat zero. Spread across the last few days rather than dumped on
  // one, which is what a real week looks like.
  if (bd) {
    const thisWeek = await prisma.lead.findMany({
      where: { stage: { notIn: ["WON", "LOST"] } },
      select: { id: true },
      take: 5,
    });

    const pattern: [string, string][] = [
      ["EMAIL", "Opening email — referenced their Shopify theme speed score."],
      ["EMAIL", "Second prospect from the same vertical, same angle."],
      ["DM", "Instagram DM to the founder; they follow us back."],
      ["CALL", "Quick discovery call, 12 minutes. Interested but slow."],
      ["EMAIL", "Intro to the ops lead they pointed us at."],
      ["FOLLOW_UP", "Nudged the proposal from last week."],
      ["MEETING", "Full funnel walkthrough with their team."],
      ["EMAIL", "Cold outreach batch — six sent, this one replied."],
      ["DM", "LinkedIn message after the podcast mention."],
      ["EMAIL", "Follow-on with the case study attached."],
      ["CALL", "Answered their pricing question on the phone."],
      ["EMAIL", "Recap of the call in writing."],
    ];

    // Monday of the current agency week, so everything lands inside it.
    const weekday = karachiWeekday(now);
    const monday = addDays(now, -(weekday - 1));

    // Repeated so the week reaches a realistic outreach volume — a target of
    // 40 with 12 logged would show the bar permanently in the red.
    const week = [...pattern, ...pattern, ...pattern];

    for (const [index, [type, note]] of week.entries()) {
      const lead = thisWeek[index % Math.max(1, thisWeek.length)];
      if (!lead) break;

      // Spread across the days of the week that have already happened.
      const dayOffset = Math.min(weekday - 1, Math.floor(index / 6));

      await prisma.salesActivity.create({
        data: {
          leadId: lead.id,
          userId: bd.id,
          type,
          note,
          occurredAt: addDays(monday, dayOffset + (index % 2) * 0.3),
        },
      });
      activityCount += 1;
    }
  }

  // A won deal that already became a client, so the provenance link is visible.
  const maison = await prisma.client.findFirst({ where: { businessName: "Maison Rue" } });
  const won = await prisma.lead.findFirst({ where: { stage: "WON", convertedClientId: null } });
  if (maison && won) {
    await prisma.lead.update({
      where: { id: won.id },
      data: { convertedClientId: maison.id, convertedAt: addDays(now, -10) },
    });
  }

  // --- Six months of MRR ----------------------------------------------------
  const activeNow = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { monthlyBudget: true },
  });
  const current = activeNow.reduce((sum, client) => sum + client.monthlyBudget, 0);

  // Walked backwards with a plausible growth curve rather than forwards from
  // a guess, so the series always lands exactly on today's real figure.
  let snapshots = 0;
  let running = current;
  for (let back = 1; back <= 5; back += 1) {
    const cycle = agencyYearMonth(addDays(now, -back * 30));
    running = Math.round(running / (1 + 0.06 + (back % 3) * 0.02));

    await prisma.mrrSnapshot.create({
      data: {
        year: cycle.year,
        month: cycle.month,
        amount: running,
        activeClients: Math.max(1, activeNow.length - Math.floor(back / 2)),
        capturedAt: addDays(now, -back * 30),
      },
    });
    snapshots += 1;
  }

  return {
    leads: leadCount,
    salesActivities: activityCount,
    activityTargets: targets,
    mrrSnapshots: snapshots,
  };
}

/**
 * The Phase 8 fairness surfaces, with enough in them to be worth looking at:
 * work blocked on a client, a couple of outage reports awaiting a decision,
 * and some protected break time.
 *
 * Deliberately built out of the real service functions where the clock matters
 * — a hand-written BlockPeriod row would be a fixture that agrees with the
 * schema but not necessarily with `blockMilestone`.
 */
async function seedFairness(adminId: string) {
  await prisma.blockPeriod.deleteMany({});
  await prisma.outageReport.deleteMany({});
  await prisma.breakSession.deleteMany({});
  await prisma.milestone.updateMany({
    data: {
      blockedReason: null,
      blockedNote: null,
      blockedSince: null,
      blockedMinutes: 0,
      statusBeforeBlock: null,
      blockingMilestoneId: null,
    },
  });

  const now = new Date();
  let blocks = 0;
  let outages = 0;
  let breaks = 0;

  // --- Blocked work ---------------------------------------------------------
  const open = await prisma.milestone.findMany({
    where: { status: "IN_PROGRESS", assigneeId: { not: null } },
    orderBy: { dueDate: "asc" },
    take: 3,
    select: { id: true, assigneeId: true },
  });

  const blockScenarios = [
    {
      reason: "CLIENT",
      note: "Waiting on the client to approve ad account access — requested Monday.",
      startedDaysAgo: 3.2,
      close: false,
    },
    {
      reason: "EXTERNAL",
      note: "Meta review has the campaign in pending status; nothing to do until it clears.",
      startedDaysAgo: 1.4,
      close: false,
    },
    {
      reason: "CLIENT",
      note: "Product photography never arrived; chased twice.",
      startedDaysAgo: 6,
      close: true,
    },
  ];

  for (const [index, milestone] of open.entries()) {
    const scenario = blockScenarios[index];
    if (!scenario || !milestone.assigneeId) continue;

    const startedAt = addDays(now, -scenario.startedDaysAgo);

    if (scenario.close) {
      // A block that already ended: the time is banked and the deadline has
      // moved, which is what makes the shifted-deadline chip visible.
      const endedAt = addDays(startedAt, 2.1);
      const minutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);

      await prisma.blockPeriod.create({
        data: {
          milestoneId: milestone.id,
          reason: scenario.reason,
          note: scenario.note,
          startedAt,
          endedAt,
          minutes,
          createdById: milestone.assigneeId,
          releasedById: milestone.assigneeId,
        },
      });
      await prisma.milestone.update({
        where: { id: milestone.id },
        data: { blockedMinutes: minutes },
      });
    } else {
      await prisma.blockPeriod.create({
        data: {
          milestoneId: milestone.id,
          reason: scenario.reason,
          note: scenario.note,
          startedAt,
          createdById: milestone.assigneeId,
        },
      });
      await prisma.milestone.update({
        where: { id: milestone.id },
        data: {
          status: "BLOCKED",
          statusBeforeBlock: "IN_PROGRESS",
          blockedReason: scenario.reason,
          blockedNote: scenario.note,
          blockedSince: startedAt,
        },
      });
    }
    blocks += 1;
  }

  // --- Outage reports -------------------------------------------------------
  const team = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const outageScenarios = [
    {
      type: "POWER",
      note: "Load-shedding block, no backup power until the evening.",
      status: "PENDING",
    },
    {
      type: "INTERNET",
      note: "Fibre cut in the area — confirmed with the ISP.",
      status: "APPROVED",
    },
  ];

  for (const [index, scenario] of outageScenarios.entries()) {
    const member = team[index];
    if (!member) continue;

    // Built around a check that actually exists, rather than at an arbitrary
    // hour: an outage that overlaps nothing produces an inbox row with nothing
    // to decide, which is a fixture that agrees with the schema and with
    // nothing else.
    const target = await prisma.availabilityCheck.findFirst({
      where: { status: "MISSED", day: { userId: member.id } },
      orderBy: { scheduledAt: "desc" },
      include: { day: { select: { userId: true } } },
    });
    if (!target) continue;

    const startsAt = new Date(target.scheduledAt.getTime() - 20 * 60_000);
    const endsAt = new Date(target.windowEndsAt.getTime() + 10 * 60_000);

    const report = await prisma.outageReport.create({
      data: {
        userId: member.id,
        type: scenario.type,
        startsAt,
        endsAt,
        note: scenario.note,
        status: scenario.status,
        // Both were filed after the check had already expired — which is the
        // normal case, because an outage stops you filing about it.
        filedLate: true,
        ...(scenario.status === "APPROVED"
          ? { reviewedById: adminId, reviewedAt: addDays(endsAt, 0.4) }
          : {}),
      },
    });

    await prisma.availabilityCheck.update({
      where: { id: target.id },
      data: {
        outageReportId: report.id,
        status: scenario.status === "APPROVED" ? "EXCUSED" : "PENDING_REVIEW",
      },
    });

    // An upheld outage reverses the charge it already produced. The original
    // penalty stays on the ledger — the reversal sits beside it.
    if (scenario.status === "APPROVED") {
      const original = await prisma.scoreEvent.findUnique({
        where: { dedupeKey: `check:${target.id}:MISS` },
      });
      if (original) {
        const cycle = agencyYearMonth(original.createdAt);
        await prisma.scoreEvent.create({
          data: {
            userId: original.userId,
            milestoneId: null,
            type: "MANUAL_ADJUST",
            points: Math.abs(original.points),
            reason: "Excused: missed availability check — outage reported (internet).",
            year: cycle.year,
            month: cycle.month,
            dedupeKey: `excuse:${original.id}`,
            createdById: adminId,
          },
        });
      }
    }
    outages += 1;
  }

  // --- Break sessions -------------------------------------------------------
  for (const [index, member] of team.entries()) {
    for (let back = 1; back <= 5; back += 1) {
      const day = karachiDay(addDays(now, -back));
      if (!(await prisma.attendanceDay.findFirst({ where: { userId: member.id, date: day, clockInAt: { not: null } } }))) {
        continue;
      }

      // Two prayer breaks and a meal — the ordinary shape of a shift here.
      const pattern = [
        { reason: "PRAYER", minutes: 15, atMinutes: 13 * 60 + 30 },
        { reason: "MEAL", minutes: 30 + ((index + back) % 15), atMinutes: 16 * 60 },
        { reason: "PRAYER", minutes: 15, atMinutes: 18 * 60 + 45 },
      ];

      for (const slot of pattern) {
        const startedAt = karachiInstant(day, slot.atMinutes);
        await prisma.breakSession.create({
          data: {
            userId: member.id,
            date: day,
            reason: slot.reason,
            startedAt,
            endedAt: new Date(startedAt.getTime() + slot.minutes * 60_000),
            minutes: slot.minutes,
          },
        });
        breaks += 1;
      }
    }
  }

  return { blockPeriods: blocks, outageReports: outages, breakSessions: breaks };
}

/**
 * A little conversation and history, so the drawer and the activity feed open
 * with something real in them rather than three empty states.
 */
async function seedCollaboration(adminId: string) {
  await prisma.comment.deleteMany({});
  await prisma.activity.deleteMany({});

  const members = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const milestones = await prisma.milestone.findMany({
    where: { assigneeId: { not: null } },
    orderBy: { dueDate: "asc" },
    take: 6,
    select: { id: true, title: true, assigneeId: true, status: true },
  });

  const SCRIPT = [
    "Kicked this off — the tracking plan is in the shared drive.",
    "@{owner} the client asked for one more concept direction. Fine to add a day?",
    "Approved on the call. Numbers look healthy so far.",
    "Blocked on brand assets — chased the client this morning.",
  ];

  let comments = 0;
  let activity = 0;

  for (const [index, milestone] of milestones.entries()) {
    const author = members.find((m) => m.id === milestone.assigneeId);
    if (!author) continue;

    const body = SCRIPT[index % SCRIPT.length].replace(
      "{owner}",
      members.find((m) => m.id === adminId)?.name ?? "Hamza Sheikh",
    );

    const mentioned = mentionedUserIds(body, members).filter((id) => id !== author.id);

    const comment = await prisma.comment.create({
      data: {
        milestoneId: milestone.id,
        userId: author.id,
        body,
        mentions: { create: mentioned.map((userId) => ({ userId })) },
      },
    });
    comments += 1;

    // Every other thread gets a reply from the owner.
    if (index % 2 === 1) {
      await prisma.comment.create({
        data: {
          milestoneId: milestone.id,
          userId: adminId,
          parentId: comment.id,
          body: "Yes — take the extra day, but keep week 4 where it is.",
        },
      });
      comments += 1;
    }

    await prisma.activity.create({
      data: {
        type: "COMMENT_ADDED",
        summary: `commented on "${milestone.title}"`,
        detail: body.slice(0, 120),
        milestoneId: milestone.id,
        actorId: author.id,
      },
    });
    activity += 1;
  }

  // A spread of the other activity types, so the feed shows real variety.
  for (const milestone of milestones.slice(0, 4)) {
    await prisma.activity.create({
      data: {
        type: "STATUS_CHANGED",
        summary: `moved "${milestone.title}" from Pending to In progress`,
        milestoneId: milestone.id,
        actorId: milestone.assigneeId,
      },
    });
    activity += 1;
  }

  const scored = await prisma.scoreEvent.findMany({
    take: 4,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } }, milestone: { select: { id: true } } },
  });

  for (const event of scored) {
    await prisma.activity.create({
      data: {
        type: "SCORE_EVENT",
        summary: `${event.points > 0 ? "+" : "−"}${Math.abs(event.points).toFixed(1)} for ${event.user.name}`,
        detail: event.reason,
        milestoneId: event.milestone?.id ?? null,
        actorId: event.createdById,
        createdAt: event.createdAt,
      },
    });
    activity += 1;
  }

  return { comments, activity };
}

/**
 * Runs the real generator over the seeded history so the reporting screens
 * open with genuine documents, then leaves a few notifications so the bell has
 * something in it.
 */
async function seedReportsAndNotifications() {
  await prisma.report.deleteMany({});
  await prisma.notification.deleteMany({});

  const now = new Date();

  // Last week and last month have closed, so those are the periods a real
  // agency would already be holding reports for.
  const lastWeek = addDays(now, -7);
  const lastMonth = addDays(now, -30);

  const [weekly, monthly] = await Promise.all([
    generateReports({ types: ["MEMBER_WEEKLY", "CLIENT_WEEKLY"], reference: lastWeek, sendEmails: false }),
    generateReports({ types: ["MEMBER_MONTHLY"], reference: lastMonth, sendEmails: false }),
  ]);

  const reports =
    weekly.memberWeekly + weekly.clientWeekly + monthly.memberMonthly;

  // A handful of in-app notices across the team.
  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true },
  });

  let notifications = await prisma.notification.count();

  const upcoming = await prisma.milestone.findMany({
    where: { assigneeId: { not: null }, status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { dueDate: "asc" },
    take: 4,
    select: { id: true, title: true, dueDate: true, assigneeId: true },
  });

  for (const milestone of upcoming) {
    const created = await notify({
      userId: milestone.assigneeId!,
      type: "TASK_ASSIGNED",
      title: "New milestone assigned to you",
      body: `${milestone.title} — due ${formatDate(milestone.dueDate)}.`,
      href: "/my-tasks",
      milestoneId: milestone.id,
    });
    if (created) notifications += 1;
  }

  const approved = await prisma.milestone.findFirst({
    where: { status: "COMPLETED", assigneeId: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { id: true, title: true, assigneeId: true },
  });

  if (approved) {
    const created = await notify({
      userId: approved.assigneeId!,
      type: "WORK_APPROVED",
      title: "Your work was approved",
      body: `${approved.title} is signed off.`,
      href: "/my-tasks",
      milestoneId: approved.id,
    });
    if (created) notifications += 1;
  }

  // Leave the first member's notices unread so the bell shows a count.
  if (members.length > 1) {
    await prisma.notification.updateMany({
      where: { userId: { in: members.slice(1).map((m) => m.id) } },
      data: { readAt: new Date() },
    });
  }

  return { reports, notifications };
}

/**
 * Gives seeded milestones a believable spread of states based on how their due
 * date sits relative to today: long past = done (some late), just past = late
 * or slipping, near future = in flight, far future = untouched.
 */
function sampleProgress(dueDate: Date, now: Date) {
  const deadline = dueDeadline(dueDate);
  const daysFromNow = Math.round((deadline.getTime() - now.getTime()) / 86_400_000);
  const roll = Math.abs(hash(dueDate.toISOString()));

  if (daysFromNow < -6) {
    // Comfortably in the past: completed, most on time, one in three late.
    //
    // Engine v2 makes the gap between the two stamps meaningful, so the sample
    // data deliberately includes an approval that landed days after a
    // submission. Under v1 that member would have been charged LATE for the
    // owner's delay; under v2 they are not, and the demo shows it.
    const late = roll % 3 === 0;
    const slowReview = roll % 5 === 0;
    const submittedAt = addDays(deadline, late ? 1 : -2);

    return {
      status: "COMPLETED",
      submittedAt,
      completedAt: addDays(submittedAt, slowReview ? 3.4 : 0.2),
      adminReviewMinutes: Math.round((slowReview ? 3.4 : 0.2) * 24 * 60),
    };
  }

  if (daysFromNow < 0) {
    // Handed in and waiting on the owner. Ageing on purpose, so the review
    // queue opens with green, amber and red rows in it.
    const waitedDays = (roll % 4) * 0.9;
    return {
      status: "SUBMITTED",
      submittedAt: addDays(now, -waitedDays - 0.2),
      completedAt: null,
      adminReviewMinutes: null,
    };
  }

  if (daysFromNow <= 3) {
    return { status: "IN_PROGRESS", submittedAt: null, completedAt: null, adminReviewMinutes: null };
  }

  return { status: "PENDING", submittedAt: null, completedAt: null, adminReviewMinutes: null };
}

/**
 * Runs the real scoring rules over the seeded history, so the performance
 * screens open with a genuine ledger rather than invented numbers.
 */
async function backfillScoreEvents(adminId: string) {
  await prisma.scoreEvent.deleteMany({});

  const milestones = await prisma.milestone.findMany({
    where: { assigneeId: { not: null } },
    include: { module: { include: { project: true } } },
  });

  let created = 0;

  for (const milestone of milestones) {
    const facts = {
      id: milestone.id,
      title: milestone.title,
      weight: milestone.weight,
      deadline: dueDeadline(milestone.dueDate),
      blockedMinutes: milestone.blockedMinutes,
      // Engine v2: lateness is judged here, on the submission.
      submittedAt: milestone.submittedAt,
      completedAt: milestone.completedAt,
      assigneeId: milestone.assigneeId,
    };

    const proposals =
      milestone.status === "COMPLETED"
        ? evaluateCompletion(facts)
        : milestone.module.project.endDate < new Date()
          ? evaluateMissed(facts)
          : [];

    for (const proposal of proposals) {
      // Dated to the submission, not the approval — the event describes when
      // the member delivered, so it belongs to that month's ledger.
      const at =
        milestone.submittedAt ?? milestone.completedAt ?? milestone.module.project.endDate;
      const cycle = agencyYearMonth(at);
      await prisma.scoreEvent.create({
        data: {
          userId: proposal.userId,
          milestoneId: proposal.milestoneId,
          type: proposal.type,
          points: proposal.points,
          reason: proposal.reason,
          dedupeKey: proposal.dedupeKey,
          year: cycle.year,
          month: cycle.month,
          createdAt: at,
        },
      });
      created += 1;
    }
  }

  // One rejection, so the ledger shows every event type the UI renders.
  const submitted = await prisma.milestone.findFirst({
    where: { status: "SUBMITTED", assigneeId: { not: null } },
    orderBy: { dueDate: "asc" },
  });

  if (submitted) {
    const event = rejectionEvent(
      {
        id: submitted.id,
        title: submitted.title,
        weight: submitted.weight,
        assigneeId: submitted.assigneeId,
      },
      "Numbers in the report did not reconcile with the ad account.",
    );

    if (event) {
      const cycle = agencyYearMonth(new Date());
      await prisma.scoreEvent.create({
        data: {
          userId: event.userId,
          milestoneId: event.milestoneId,
          type: event.type,
          points: event.points,
          reason: event.reason,
          dedupeKey: null,
          year: cycle.year,
          month: cycle.month,
          createdById: adminId,
        },
      });
      created += 1;
    }
  }

  return created;
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Small stable hash so the sample spread is the same on every seed run. */
function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  return result;
}

function print(stats: {
  projectCount: number;
  milestoneCount: number;
  scoreEvents: number;
  reports: number;
  notifications: number;
  comments: number;
  activity: number;
  attendanceDays: number;
  availabilityChecks: number;
  leaveRequests: number;
  blockPeriods: number;
  outageReports: number;
  breakSessions: number;
  leads: number;
  salesActivities: number;
  activityTargets: number;
  mrrSnapshots: number;
  qualityRatings: number;
  kpiWeeks: number;
  paidCycles: number;
}) {
  const line = "─".repeat(62);
  const row = (email: string, password: string, label: string) =>
    `  ${email.padEnd(24)} ${password.padEnd(11)} ${label}`;

  console.log(`\n${line}`);
  console.log("  AGENCY OS — seeded accounts");
  console.log(line);
  console.log(row("EMAIL", "PASSWORD", "ROLE"));
  console.log(line);
  console.log(row(ADMIN.email, ADMIN_PASSWORD, `ADMIN · ${ADMIN.jobTitle}`));
  for (const member of TEAM) {
    console.log(row(member.email, MEMBER_PASSWORD, `MEMBER · ${member.jobTitle}`));
  }
  console.log(line);
  console.log(
    `  ${CLIENTS.length} clients · ${stats.projectCount} projects · ` +
      `${stats.milestoneCount} milestones · ${stats.scoreEvents} score events`,
  );
  console.log(`  ${stats.reports} reports · ${stats.notifications} notifications`);
  console.log(`  ${stats.comments} comments · ${stats.activity} activity entries`);
  console.log(
    `  ${stats.attendanceDays} attendance days · ${stats.availabilityChecks} checks · ` +
      `${stats.leaveRequests} leave requests`,
  );
  console.log(
    `  ${stats.blockPeriods} block periods · ${stats.outageReports} outage reports · ` +
      `${stats.breakSessions} break sessions`,
  );
  console.log(
    `  ${stats.leads} leads · ${stats.salesActivities} sales activities · ` +
      `${stats.activityTargets} targets · ${stats.mrrSnapshots} MRR snapshots`,
  );
  console.log(
    `  ${stats.qualityRatings} quality ratings · ${stats.kpiWeeks} KPI weeks · ` +
      `${stats.paidCycles} cycles paid`,
  );
  console.log(`${line}\n`);
  console.log("  Sign in at http://localhost:3000/login\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
