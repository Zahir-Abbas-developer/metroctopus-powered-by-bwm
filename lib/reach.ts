import { prisma } from "@/lib/prisma";
import { formatKarachiTime } from "@/lib/attendance-time";

/**
 * Getting hold of someone who isn't looking at the app.
 *
 * The availability banner works only for a member with a tab open, which is
 * precisely the member who didn't need reminding. Two channels reach the rest:
 *
 *   **Web Push** — the primary one. Needs VAPID keys; without them push is
 *   skipped and everything else still works.
 *
 *   **WhatsApp** — optional and env-gated, because it is how this team
 *   actually talks. If the WHATSAPP_* variables are unset the call is a silent
 *   no-op, so the app is fully functional without a Meta account.
 *
 * Nothing here throws into its caller. A push service being down must never
 * roll back the check that triggered it — the member would then be neither
 * notified nor charged, and the ledger would disagree with the board.
 *
 * Deliberately not marked `server-only`: the seed reaches this through the
 * attendance service, and `server-only` throws outside a React Server
 * environment. `web-push` is imported lazily instead, so a deployment with no
 * VAPID keys never loads it.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Deep link opened when the notification is tapped. */
  url?: string;
  tag?: string;
  /** Keeps the notification on screen until acted on — used for live checks. */
  requireInteraction?: boolean;
};

export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_TEMPLATE_NAME,
  );
}

export type PushResult = {
  status: "sent" | "skipped" | "no-subscriptions";
  delivered: number;
  removed: number;
};

/**
 * Sends a push to every device a member has registered.
 *
 * Endpoints that answer 404 or 410 are gone for good — an uninstalled app, a
 * cleared browser — so they are deleted rather than retried forever.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<PushResult> {
  if (!pushConfigured()) return { status: "skipped", delivered: 0, removed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) {
    return { status: "no-subscriptions", delivered: 0, removed: 0 };
  }

  // Imported lazily so a deployment without push never loads the library, and
  // so this module stays importable from scripts.
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  let delivered = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      delivered += 1;
      await prisma.pushSubscription
        .update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
        removed += 1;
      } else {
        console.error("push failed", statusCode ?? error);
      }
    }
  }

  return { status: "sent", delivered, removed };
}

/**
 * The WhatsApp template message for an availability check.
 *
 * Deliberately narrow: this fires for the one notification that is genuinely
 * time-critical. Pushing every report and assignment down a channel people
 * read at 2am would train them to mute it, and a muted channel reaches nobody.
 */
export async function sendWhatsAppCheck(
  phone: string,
  windowEndsAt: Date,
): Promise<"sent" | "skipped" | "failed"> {
  if (!whatsappConfigured()) return "skipped";

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: process.env.WHATSAPP_TEMPLATE_NAME,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: formatKarachiTime(windowEndsAt) }],
              },
            ],
          },
        }),
      },
    );

    if (!response.ok) {
      console.error("whatsapp failed", response.status, await response.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("whatsapp failed", error);
    return "failed";
  }
}

/**
 * Everything that fires when a check goes live: push to every device, and
 * WhatsApp if the agency has it configured.
 */
export async function sendCheckAlert(userId: string, windowEndsAt: Date): Promise<void> {
  await sendPush(userId, {
    title: "Availability check",
    body: `Tap to confirm you're at work — you have until ${formatKarachiTime(windowEndsAt)}.`,
    url: "/my-attendance",
    tag: "availability-check",
    requireInteraction: true,
  });

  if (whatsappConfigured()) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (user?.phone) await sendWhatsAppCheck(user.phone, windowEndsAt);
  }
}
