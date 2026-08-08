/**
 * Promote a user to ADMIN, or demote one back to MEMBER.
 *
 * The bootstrap-safe path to a second owner. It exists as a script rather than
 * only a UI button for one reason: the situation you most need a backup owner
 * in is the one where the only existing owner cannot sign in.
 *
 *   npm run promote -- someone@agency.local
 *   npm run promote -- someone@agency.local --demote
 *   npm run promote -- --list
 *
 * Refuses to remove the last active owner, which is the same guard the team
 * API enforces — an agency with no owner has no way back in.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const demote = args.includes("--demote");
const list = args.includes("--list");
const email = args.find((arg) => !arg.startsWith("--"));

function bail(message) {
  console.error(`\n  ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const owners = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  if (list || !email) {
    console.log(`\n  Active owners (${owners.length}):`);
    for (const owner of owners) console.log(`    ${owner.email.padEnd(28)} ${owner.name}`);
    if (!list) {
      console.log("\n  Usage: npm run promote -- <email> [--demote]\n");
    } else {
      console.log("");
    }
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return bail(`No account with the email ${email}.`);

  if (!demote) {
    if (user.role === "ADMIN") return bail(`${user.name} is already an owner.`);
    if (!user.isActive) return bail(`${user.name} is deactivated — reactivate them first.`);

    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await audit(user, "MEMBER", "ADMIN");

    console.log(`\n  ${user.name} is now an owner. ${owners.length + 1} active owners.\n`);
    return;
  }

  if (user.role !== "ADMIN") return bail(`${user.name} is not an owner.`);

  // The same guard the team API enforces: an agency with no owner is locked out.
  if (owners.length <= 1) {
    return bail("That's the last active owner. Promote someone else first.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: "MEMBER" } });
  await audit(user, "ADMIN", "MEMBER");

  console.log(`\n  ${user.name} is now a member. ${owners.length - 1} active owners.\n`);
}

/** Recorded like any other role change — a script is not an excuse to skip it. */
async function audit(user, before, after) {
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: "ROLE_CHANGED",
      entityType: "User",
      entityId: user.id,
      summary: `${user.name} changed from ${before} to ${after} via scripts/promote-admin.mjs`,
      beforeJson: JSON.stringify({ role: before }),
      afterJson: JSON.stringify({ role: after }),
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
