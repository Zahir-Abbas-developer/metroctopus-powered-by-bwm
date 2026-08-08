import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import type { Email } from "@/lib/email/templates";

/**
 * SMTP delivery.
 *
 * Configured entirely by environment, and deliberately inert when it isn't:
 * with no SMTP_HOST set, messages are logged and reported as "skipped" rather
 * than thrown. Adding a member must not fail because the mail server is down,
 * and local development must not need one at all.
 *
 * Works with any SMTP provider. Resend, Postmark and SES all expose SMTP
 * credentials, so nothing here is tied to one vendor.
 */

export type SendResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

let cached: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}

function transporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  return cached;
}

export async function sendEmail(to: string, email: Email): Promise<SendResult> {
  const mailer = transporter();

  if (!mailer) {
    // Loud enough to find in a log, quiet enough not to break the request.
    console.info(
      `[email] skipped (SMTP not configured) → ${to}: ${email.subject}`,
    );
    return { status: "skipped", reason: "SMTP not configured" };
  }

  try {
    const info = await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { status: "sent", messageId: info.messageId };
  } catch (error) {
    // Never rethrow: the work that triggered this already succeeded.
    console.error(`[email] failed → ${to}: ${email.subject}`, error);
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "unknown",
    };
  }
}

/** Absolute base URL for links inside emails. */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}
