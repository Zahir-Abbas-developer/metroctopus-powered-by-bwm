import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor } from "../lib/constants";
import { planFor, defaultAssigneeFor } from "../lib/templates";
import { addDays, dueDeadline, agencyYearMonth, toDateOnly, formatDate } from "../lib/date";
import { generateReports } from "../lib/reports";
import { notify } from "../lib/notifications";
import { mentionedUserIds } from "../lib/mentions";
import { evaluateCompletion, evaluateMissed, rejectionEvent } from "../lib/scoring";

const prisma = new PrismaClient();

const ADMIN_PASSWORD = "admin123";
const MEMBER_PASSWORD = "member123";

/** One member per service line the agency sells, plus a funnel owner. */
const TEAM = [
  { name: "Ayesha Khan", email: "ayesha@agency.local", jobTitle: "Shopify Developer" },
  { name: "Bilal Ahmed", email: "bilal@agency.local", jobTitle: "Google Ads Specialist" },
  { name: "Hira Siddiqui", email: "hira@agency.local", jobTitle: "Meta Ads Specialist" },
  { name: "Usman Tariq", email: "usman@agency.local", jobTitle: "Creative Designer" },
  { name: "Fatima Noor", email: "fatima@agency.local", jobTitle: "Creative Strategist" },
  { name: "Daniyal Raza", email: "daniyal@agency.local", jobTitle: "Funnel Manager" },
];

const ADMIN = {
  name: "Hamza Sheikh",
  email: "admin@agency.local",
  jobTitle: "Agency Owner",
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
  const { reports, notifications } = await seedReportsAndNotifications();
  const collab = await seedCollaboration(admin.id);

  print({
    projectCount,
    milestoneCount,
    scoreEvents,
    reports,
    notifications,
    ...collab,
  });
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
    generateReports({ types: ["MEMBER_WEEKLY", "CLIENT_WEEKLY"], reference: lastWeek }),
    generateReports({ types: ["MEMBER_MONTHLY"], reference: lastMonth }),
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

  if (daysFromNow < -6) {
    // Comfortably in the past: completed, most on time, one in three late.
    const late = Math.abs(hash(dueDate.toISOString())) % 3 === 0;
    return {
      status: "COMPLETED",
      submittedAt: addDays(deadline, late ? 1 : -2),
      completedAt: addDays(deadline, late ? 1.2 : -1.8),
    };
  }

  if (daysFromNow < 0) {
    // Recently past due and still open — the rows that should look alarming.
    return { status: "SUBMITTED", submittedAt: addDays(now, -1), completedAt: null };
  }

  if (daysFromNow <= 3) {
    return { status: "IN_PROGRESS", submittedAt: null, completedAt: null };
  }

  return { status: "PENDING", submittedAt: null, completedAt: null };
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
      const at = milestone.completedAt ?? milestone.module.project.endDate;
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
