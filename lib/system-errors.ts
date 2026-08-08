import { prisma } from "@/lib/prisma";

/**
 * Recording the pages that break.
 *
 * The owner should never learn about a broken page from a WhatsApp message.
 * Every route-level error boundary and every unhandled route-handler failure
 * writes one row here, and /admin/errors shows them with a badge in the
 * sidebar.
 *
 * Two rules govern everything in this file:
 *
 *  1. **Logging an error must never cause one.** Every write is wrapped and
 *     swallowed. If the database is the thing that is broken — which is the
 *     most likely cause of a page failing — the logger failing too would turn
 *     a broken page into a broken app.
 *  2. **Nothing here is symptom-patching.** This does not catch errors to hide
 *     them; the error still propagates to the boundary and the page still
 *     fails visibly. It only writes down what happened on the way past.
 */

/** Stacks can be enormous; keep the head, which is where the cause lives. */
const STACK_LIMIT = 8_000;
const MESSAGE_LIMIT = 2_000;

export type SystemErrorInput = {
  route: string;
  message: string;
  stack?: string | null;
  digest?: string | null;
  userId?: string | null;
  userRole?: string | null;
};

export async function recordSystemError(input: SystemErrorInput): Promise<void> {
  try {
    await prisma.systemError.create({
      data: {
        route: input.route.slice(0, 500),
        message: (input.message || "Unknown error").slice(0, MESSAGE_LIMIT),
        stack: input.stack ? input.stack.slice(0, STACK_LIMIT) : null,
        digest: input.digest ?? null,
        userId: input.userId ?? null,
        userRole: input.userRole ?? null,
      },
    });
  } catch {
    // Deliberately silent. See rule 1 above.
  }
}

/** Pulls the useful parts out of whatever was thrown. */
export function describeError(error: unknown): { message: string; stack: string | null; digest: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? null,
      digest: (error as { digest?: string }).digest ?? null,
    };
  }
  return { message: String(error), stack: null, digest: null };
}

/**
 * Wraps a route handler so an unhandled throw is recorded before it becomes a
 * 500. The error is re-thrown, not swallowed — the caller still fails.
 */
export async function withErrorLogging<T>(
  route: string,
  run: () => Promise<T>,
  context: { userId?: string | null; userRole?: string | null } = {},
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const { message, stack, digest } = describeError(error);
    await recordSystemError({ route, message, stack, digest, ...context });
    throw error;
  }
}

export type SystemErrorRow = {
  id: string;
  route: string;
  message: string;
  stack: string | null;
  digest: string | null;
  userId: string | null;
  userRole: string | null;
  seenAt: Date | null;
  createdAt: Date;
};

/** The latest errors, newest first. */
export async function recentErrors(limit = 100): Promise<SystemErrorRow[]> {
  return prisma.systemError.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** How many the owner has not looked at yet — the sidebar badge. */
export async function unseenErrorCount(): Promise<number> {
  try {
    return await prisma.systemError.count({ where: { seenAt: null } });
  } catch {
    // A badge is not worth taking the whole shell down for.
    return 0;
  }
}

/** Called when the owner opens /admin/errors. */
export async function markErrorsSeen(): Promise<void> {
  try {
    await prisma.systemError.updateMany({
      where: { seenAt: null },
      data: { seenAt: new Date() },
    });
  } catch {
    // Same reasoning as above.
  }
}
