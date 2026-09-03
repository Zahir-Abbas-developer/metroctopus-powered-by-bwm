import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor } from "../lib/constants";

/**
 * Production seed: the owner account, and the service catalogue. Nothing else.
 *
 * `npm run db:seed` creates a demo agency — five clients, fifty-five
 * milestones, invented people. That is exactly what you do not want in a
 * production database, so production gets this instead.
 *
 * Credentials come from the environment and are validated rather than
 * defaulted: shipping with admin/admin123 because someone forgot a variable is
 * the failure mode worth designing against.
 *
 *   ADMIN_EMAIL="you@agency.com" ADMIN_PASSWORD="…" ADMIN_NAME="Your Name" \
 *     npm run db:seed:admin
 */

const prisma = new PrismaClient();

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

/** Rejected outright — these exist in the demo seed and in every wordlist. */
const BANNED_PASSWORDS = new Set([
  "admin123",
  "member123",
  "password",
  "password123",
  "changeme",
  "letmein",
]);

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Agency Owner";
  const jobTitle = process.env.ADMIN_JOB_TITLE?.trim() || "Agency Owner";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Set ADMIN_EMAIL to a valid email address.");
  }
  if (!password) {
    fail("Set ADMIN_PASSWORD.");
  }
  if (password.length < 12) {
    fail("ADMIN_PASSWORD must be at least 12 characters for a production owner.");
  }
  if (BANNED_PASSWORDS.has(password.toLowerCase())) {
    fail("That password is one of the demo or well-known defaults. Pick another.");
  }

  for (const service of SERVICES) {
    await prisma.serviceCatalog.upsert({
      where: { slug: service.slug },
      update: {},
      create: { ...service, isActive: true },
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  const owner = await prisma.user.upsert({
    where: { email },
    // An existing owner keeps their password; this script is not a reset tool.
    update: { role: "ADMIN", isActive: true },
    create: {
      name,
      email,
      jobTitle,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
      avatarColor: avatarColorFor(email),
      isActive: true,
    },
  });

  const line = "─".repeat(58);
  console.log(`\n${line}`);
  console.log("  BWM — production seed");
  console.log(line);
  console.log(`  Owner       ${owner.email}`);
  console.log(`  Password    ${existing ? "unchanged (account already existed)" : "as provided"}`);
  console.log(`  Services    ${SERVICES.length} in the catalogue`);
  console.log(`${line}\n`);
  console.log("  Sign in, then add your team from /team.\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
