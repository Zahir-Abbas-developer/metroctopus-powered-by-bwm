import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor } from "../lib/constants";

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

async function main() {
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 10);

  // Upsert so re-running the seed refreshes credentials without duplicating
  // people or orphaning anything a later phase attaches to them.
  await prisma.user.upsert({
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

  print();
}

function print() {
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
