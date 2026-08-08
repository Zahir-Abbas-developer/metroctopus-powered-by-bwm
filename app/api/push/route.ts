import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { pushConfigured, sendPush } from "@/lib/reach";

/**
 * Push subscriptions.
 *
 * One row per device. The endpoint is unique, so re-subscribing on a browser
 * that already registered updates the existing row rather than accumulating
 * duplicates and pushing the same notification three times.
 */

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Tells the client whether push is available and which key to subscribe with. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const count = await prisma.pushSubscription.count({ where: { userId: user.id } });

  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    subscriptions: count,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  if (!pushConfigured()) {
    return apiError("Push isn't configured on this deployment", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("That subscription didn't look right", 422, fieldErrors(parsed.error));
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 255) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: user.id,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
    create: {
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
  });

  // A confirmation the member can see, so "enabled" is never a claim the app
  // makes without evidence.
  await sendPush(user.id, {
    title: "Notifications are on",
    body: "You'll be alerted the moment an availability check goes live.",
    url: "/my-attendance",
    tag: "push-enabled",
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let endpoint: string | null = null;
  try {
    endpoint = ((await request.json()) as { endpoint?: string })?.endpoint ?? null;
  } catch {
    // Falls through to clearing every device.
  }

  await prisma.pushSubscription.deleteMany({
    where: { userId: user.id, ...(endpoint ? { endpoint } : {}) },
  });

  return NextResponse.json({ ok: true });
}
