import { PrismaClient } from "@prisma/client";

/**
 * A single Prisma client per process. Next.js dev mode re-evaluates modules on
 * every hot reload, which would otherwise open a new connection pool each time.
 *
 * Logging is warn-and-above rather than error-and-above on purpose. Several
 * flows here rely on a unique constraint firing — re-running the evaluation
 * job, regenerating a report, raising the same deadline notice twice — and
 * Prisma logs every one of those at error level before throwing, even though
 * the caller catches it and treats it as the expected outcome. Left on, a
 * healthy production log fills with "errors" that are the idempotency working.
 * Genuine failures are still surfaced: every catch here logs what it swallowed.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
