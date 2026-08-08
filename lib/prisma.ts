import { PrismaClient } from "@prisma/client";

/**
 * A single Prisma client per process. Next.js dev mode re-evaluates modules on
 * every hot reload, which would otherwise open a new connection pool each time.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
