import type { Metadata } from "next";
import Link from "next/link";
import {
  Briefcase,
  CalendarClock,
  CheckSquare,
  Gauge,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";

import { requireUser } from "@/lib/session";
import { formatDateLong, greeting } from "@/lib/date";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const firstName = (user.name ?? "there").split(" ")[0];

  return (
    <div className="space-y-8">
      {searchParams.denied === "admin" && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-card border border-warn/20 bg-warn-tint px-4 py-3 text-[13px] leading-relaxed text-warn"
        >
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            That area is limited to the agency owner. You&rsquo;ve been returned
            to your dashboard.
          </span>
        </div>
      )}

      <PageHeader
        variant="dark"
        eyebrow={formatDateLong(new Date())}
        title={`${greeting()}, ${firstName}`}
        description={
          isAdmin
            ? "Here's where the agency stands today. Client delivery, deadlines and team performance, all in one view."
            : "Here's your work at a glance. Your milestones, deadlines and performance score for this month."
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Retainer cycle", value: "Monthly" },
            { label: "Working timezone", value: "Asia / Karachi" },
            { label: "Your role", value: isAdmin ? "Owner" : user.jobTitle },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[10px] border border-paper/10 bg-paper/[0.04] px-4 py-3"
            >
              <p className="eyebrow text-paper/35">{item.label}</p>
              <p className="mt-1.5 text-sm font-medium text-paper/85">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </PageHeader>

      {/* Metrics — zeroed until Phases 2–5 land the underlying data */}
      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {isAdmin ? "Agency at a glance" : "Your month"}
          </h2>
          <p className="text-[13px] text-ink/40">Updates as work is logged</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active clients"
            value={0}
            icon={Briefcase}
            tone="info"
            hint={isAdmin ? "On a live monthly retainer" : "Clients you're assigned to"}
          />
          <StatCard
            label="Open tasks"
            value={0}
            icon={CheckSquare}
            tone="neutral"
            hint="Not yet marked complete"
          />
          <StatCard
            label="On-time rate"
            value={0}
            unit="%"
            icon={Timer}
            tone="success"
            hint="Milestones delivered by their deadline"
          />
          <StatCard
            label={isAdmin ? "Avg team score" : "Your score"}
            value={0}
            unit="pts"
            icon={Gauge}
            tone="warning"
            hint="Starts at 100 each month"
          />
        </div>
      </section>

      {/* Designed empty states rather than blank panels */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <CardHeader
            title="Upcoming deadlines"
            description="Milestones due in the next seven days"
          />
          <EmptyState
            icon={CalendarClock}
            eyebrow="Nothing scheduled"
            title="No deadlines on the horizon"
            description={
              isAdmin
                ? "Once clients are onboarded and their monthly modules are planned, every deadline lands here."
                : "When the owner plans this month's modules, your milestones will appear here."
            }
            action={
              isAdmin ? (
                <Link href="/team" className={buttonClasses("secondary", "md")}>
                  Review your team
                </Link>
              ) : undefined
            }
          />
        </Card>

        <Card padded={false}>
          <CardHeader
            title="Recent activity"
            description="Task movement across the agency"
          />
          <EmptyState
            icon={Sparkles}
            eyebrow="Quiet so far"
            title="No activity yet"
            description="Completed tasks, missed deadlines and score changes will stream into this feed as the team works."
          />
        </Card>
      </section>
    </div>
  );
}
