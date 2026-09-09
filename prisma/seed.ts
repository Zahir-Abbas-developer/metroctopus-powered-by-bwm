import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor, FIELD_ENTITIES } from "../lib/constants";
import { serializeSkills } from "../lib/skills";

/**
 * BWM seed — the starting shape of the business, not the shape of the system.
 *
 * Everything here is a database record an admin can edit afterwards:
 * departments, their pipeline stages, their field definitions, and who works in
 * which department. Nothing in the app may assume there are four departments
 * or that they are named what they are named today.
 *
 * Deliberately absent: demo clients, demo leads, demo deals, invented numbers.
 * The agency fork seeded five clients and fifty-five milestones so its screens
 * looked populated; every figure BWM sees must come from real work, so this
 * seeds structure and people and stops there. The old file is kept as
 * `prisma/seed.agency.archive` for reference.
 *
 * Placeholder passwords are paired with `mustChangePassword: true`, so a
 * seeded credential cannot survive first contact with a real user. Override
 * the default with SEED_PASSWORD.
 */

const prisma = new PrismaClient();

const PLACEHOLDER_PASSWORD = process.env.SEED_PASSWORD ?? "bwm-change-me";

/** The four business lines BWM runs today. */
const DEPARTMENTS = [
  {
    slug: "pilot-cars",
    name: "BWM — Pilot Cars Sales & Dispatch",
    shortLabel: "Pilot Cars",
    colorToken: "success",
    description:
      "Sales, quotes, dispatch coordination, scheduling and job management for pilot car work.",
    order: 1,
    stages: [
      { key: "NEW_INQUIRY", label: "New Inquiry", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "QUOTE", label: "Quote", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "SCHEDULED", label: "Scheduled", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "DISPATCHED", label: "Dispatched", sortOrder: 5, kind: "OPEN", colorToken: "warning" },
      { key: "COMPLETED", label: "Completed", sortOrder: 6, kind: "WON", colorToken: "success" },
      // Kept, though the T3 list omits it. The spec says "add Lost" for two of
      // the other three departments, so its absence here reads as the same
      // oversight rather than an intent — and without it a dead inquiry has
      // nowhere to go, which is how a board silently fills with stale cards.
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      { key: "pickup_location", label: "Pickup location", type: "TEXT", order: 1, required: true },
      { key: "destination", label: "Destination", type: "TEXT", order: 2, required: true },
      {
        key: "service_requirements",
        label: "Service requirements",
        type: "TEXTAREA",
        order: 3,
      },
      {
        key: "dispatch_requirements",
        label: "Dispatch requirements",
        type: "TEXTAREA",
        order: 4,
      },
      {
        key: "vehicle_job_details",
        label: "Vehicle / job details",
        type: "TEXTAREA",
        order: 5,
      },
      { key: "quote", label: "Quote", type: "CURRENCY", order: 6 },
    ],
  },
  {
    slug: "life-health-insurance",
    name: "BWM — Life & Health Insurance",
    shortLabel: "Life & Health",
    colorToken: "info",
    description: "Insurance leads, qualification, policies and conversion.",
    order: 2,
    stages: [
      { key: "NEW_LEAD", label: "New Lead", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "CONTACTED", label: "Contacted", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "PROPOSAL", label: "Application / Proposal", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "CONVERTED", label: "Converted", sortOrder: 5, kind: "WON", colorToken: "success" },
      { key: "ACTIVE_CLIENT", label: "Active Client", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      {
        key: "insurance_type",
        label: "Insurance type",
        type: "SELECT",
        options: "Life,Health,Both",
        order: 1,
        required: true,
      },
      {
        key: "qualification_info",
        label: "Qualification info",
        type: "TEXTAREA",
        order: 2,
      },
      {
        key: "coverage_requirements",
        label: "Coverage requirements",
        type: "TEXTAREA",
        order: 3,
      },
    ],
  },
  {
    slug: "affiliates",
    name: "BWM — Affiliates",
    shortLabel: "Affiliates",
    colorToken: "warning",
    description: "Partner onboarding, referral tracking and commission tracking.",
    order: 3,
    stages: [
      { key: "NEW_PARTNER", label: "New Partner", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "ONBOARDING", label: "Onboarding", sortOrder: 3, kind: "OPEN", colorToken: "warning" },
      { key: "ACTIVE", label: "Active", sortOrder: 4, kind: "WON", colorToken: "success" },
      // Referral and Commission come *after* the win: they are what an active
      // partner is doing, not a deal still being chased. ACTIVE_CLIENT is the
      // kind for exactly that — converted and ongoing.
      { key: "REFERRAL", label: "Referral", sortOrder: 5, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "COMMISSION", label: "Commission", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      { key: "affiliate_type", label: "Affiliate type", type: "TEXT", order: 1 },
      { key: "referral_info", label: "Referral info", type: "TEXTAREA", order: 2 },
      {
        key: "commission_rate",
        label: "Commission rate (%)",
        type: "NUMBER",
        helpText: "A percentage — 12.5 means 12.5%.",
        order: 3,
      },
      { key: "commission_notes", label: "Commission notes", type: "TEXTAREA", order: 4 },
    ],
  },
  {
    slug: "culture-plus-network",
    name: "Culture Plus Network",
    shortLabel: "Culture Plus",
    colorToken: "neutral",
    description: "Sales, Cam, and Life & Health Insurance under the Culture Plus Network brand.",
    order: 4,
    stages: [
      { key: "NEW_LEAD", label: "New Lead", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "CONTACTED", label: "Contacted", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "PROPOSAL", label: "Proposal", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "NEGOTIATION", label: "Negotiation", sortOrder: 5, kind: "OPEN", colorToken: "warning" },
      { key: "WON", label: "Won", sortOrder: 6, kind: "WON", colorToken: "success" },
      { key: "ACTIVE_CLIENT", label: "Active Client", sortOrder: 7, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 8, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      {
        key: "service_interest",
        label: "Service / product interest",
        type: "TEXT",
        order: 1,
      },
      {
        // "Cam" is a sales/service category here, not the team member of the
        // same name. Cam the person is not a member of this department.
        key: "sales_category",
        label: "Sales category",
        type: "SELECT",
        options: "Sales,Cam,Life Insurance,Health Insurance",
        order: 2,
        required: true,
      },
      {
        // Asking every question of every lead is how a form stops being filled
        // in honestly, so the two specialist blocks below appear only for the
        // category they belong to.
        key: "insurance_info",
        label: "Insurance info",
        type: "TEXTAREA",
        order: 3,
        showIfKey: "sales_category",
        showIfValues: "Life Insurance,Health Insurance",
      },
      {
        key: "cam_info",
        label: "Cam details",
        type: "TEXTAREA",
        order: 4,
        showIfKey: "sales_category",
        showIfValues: "Cam",
      },
    ],
  },
] as const;

/**
 * The only users.
 *
 * `departments` carries the membership matrix from CLAUDE.md, and per-department
 * skills describing what that person actually does in that business line.
 * Skills are free-text strings, not an enum: a department can need a speciality
 * nobody anticipated, and an enum would put that behind a deploy.
 *
 * `jobTitle` is legacy from the agency fork and is kept only because the column
 * is required. Department membership below is the real mapping.
 */
const TEAM = [
  {
    name: "Coach D",
    email: "coachd@bwm.local",
    role: "ADMIN",
    jobTitle: "Owner",
    departments: [
      { slug: "pilot-cars", roleInDept: "LEAD", skills: ["sales", "dispatch", "closing"] },
      { slug: "life-health-insurance", roleInDept: "LEAD", skills: ["insurance", "closing"] },
      { slug: "affiliates", roleInDept: "LEAD", skills: ["affiliates", "partnerships"] },
      { slug: "culture-plus-network", roleInDept: "LEAD", skills: ["sales", "insurance", "closing"] },
    ],
  },
  {
    name: "Tayyaba",
    email: "tayyaba@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Insurance",
    departments: [
      { slug: "pilot-cars", roleInDept: "MEMBER", skills: ["sales", "quotes", "scheduling"] },
      { slug: "life-health-insurance", roleInDept: "MEMBER", skills: ["insurance", "qualification"] },
    ],
  },
  {
    name: "Claire",
    email: "claire@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Insurance",
    departments: [
      { slug: "pilot-cars", roleInDept: "MEMBER", skills: ["sales", "dispatch", "scheduling"] },
      { slug: "life-health-insurance", roleInDept: "MEMBER", skills: ["insurance", "policies"] },
      { slug: "culture-plus-network", roleInDept: "MEMBER", skills: ["sales", "insurance"] },
    ],
  },
  {
    name: "Cam",
    email: "cam@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Affiliates",
    departments: [
      { slug: "pilot-cars", roleInDept: "MEMBER", skills: ["sales", "dispatch"] },
      { slug: "life-health-insurance", roleInDept: "MEMBER", skills: ["insurance", "qualification"] },
      { slug: "affiliates", roleInDept: "LEAD", skills: ["affiliates", "referrals", "commissions"] },
    ],
  },
  {
    name: "Cheryl",
    email: "cheryl@bwm.local",
    role: "MEMBER",
    jobTitle: "Culture Plus Network",
    departments: [
      { slug: "culture-plus-network", roleInDept: "MEMBER", skills: ["sales", "insurance", "follow-up"] },
    ],
  },
  {
    name: "Raja Zain",
    email: "rajazain@bwm.local",
    role: "SUPPORT_ADMIN",
    jobTitle: "System Maintainer",
    departments: [
      { slug: "pilot-cars", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "life-health-insurance", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "affiliates", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "culture-plus-network", roleInDept: "MEMBER", skills: ["support"] },
    ],
  },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash(PLACEHOLDER_PASSWORD, 10);

  // Settings singleton. The parked-module flags stay off: BWM did not ask for
  // attendance, scoring, retainer cycles or client KPIs, and off means those
  // features are absent rather than empty.
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      timezone: "America/New_York",
      featureAttendance: false,
      featureScoring: false,
      featureRetainerCycles: false,
      featureClientKpis: false,
    },
  });

  const departmentIdBySlug = new Map<string, string>();

  for (const dept of DEPARTMENTS) {
    const department = await prisma.department.upsert({
      where: { slug: dept.slug },
      update: {
        name: dept.name,
        shortLabel: dept.shortLabel,
        colorToken: dept.colorToken,
        description: dept.description,
        order: dept.order,
      },
      create: {
        slug: dept.slug,
        name: dept.name,
        shortLabel: dept.shortLabel,
        colorToken: dept.colorToken,
        description: dept.description,
        order: dept.order,
      },
    });
    departmentIdBySlug.set(dept.slug, department.id);

    for (const stage of dept.stages) {
      await prisma.pipelineStage.upsert({
        where: { departmentId_key: { departmentId: department.id, key: stage.key } },
        update: {
          label: stage.label,
          sortOrder: stage.sortOrder,
          kind: stage.kind,
          colorToken: stage.colorToken,
        },
        create: {
          departmentId: department.id,
          key: stage.key,
          label: stage.label,
          sortOrder: stage.sortOrder,
          kind: stage.kind,
          colorToken: stage.colorToken,
        },
      });
    }

    // Each department's set is seeded for both entities. The facts a business
    // line needs while qualifying a deal are the same ones it needs once that
    // deal converts; an admin can diverge them per entity afterwards, which is
    // exactly what Settings -> Departments -> Fields is for.
    for (const entity of FIELD_ENTITIES) {
      for (const field of dept.fields) {
        const shape = {
          label: field.label,
          type: field.type,
          options: "options" in field ? field.options : "",
          helpText: "helpText" in field ? field.helpText : null,
          required: "required" in field ? field.required : false,
          order: field.order,
          showIfKey: "showIfKey" in field ? field.showIfKey : null,
          showIfValues: "showIfValues" in field ? field.showIfValues : "",
        };

        await prisma.fieldDefinition.upsert({
          where: {
            departmentId_entity_key: {
              departmentId: department.id,
              entity,
              key: field.key,
            },
          },
          update: shape,
          create: { departmentId: department.id, entity, key: field.key, ...shape },
        });
      }
    }
  }

  for (const person of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, role: person.role, jobTitle: person.jobTitle },
      create: {
        name: person.name,
        email: person.email,
        passwordHash,
        role: person.role,
        jobTitle: person.jobTitle,
        mustChangePassword: true,
        avatarColor: avatarColorFor(person.name),
      },
    });

    for (const membership of person.departments) {
      const departmentId = departmentIdBySlug.get(membership.slug);
      if (!departmentId) throw new Error(`Unknown department slug: ${membership.slug}`);
      const skills = serializeSkills(membership.skills);
      await prisma.departmentMembership.upsert({
        where: { userId_departmentId: { userId: user.id, departmentId } },
        update: { roleInDept: membership.roleInDept, skills },
        create: {
          userId: user.id,
          departmentId,
          roleInDept: membership.roleInDept,
          skills,
        },
      });
    }
  }

  const [departments, stages, fields, users] = await Promise.all([
    prisma.department.count(),
    prisma.pipelineStage.count(),
    prisma.fieldDefinition.count(),
    prisma.user.count(),
  ]);
  const memberships = await prisma.departmentMembership.count();

  console.log("BWM seed complete");
  console.log(`  departments     ${departments}`);
  console.log(`  pipeline stages ${stages}`);
  console.log(`  field defs      ${fields}`);
  console.log(`  users           ${users}`);
  console.log(`  memberships     ${memberships}`);
  console.log(`\n  All accounts use the placeholder password and must change it on first login.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
