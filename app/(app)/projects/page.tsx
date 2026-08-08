import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { progressForProjects } from "@/lib/planner";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  type ProjectStatus,
} from "@/lib/constants";
import { daysUntil, dueDeadline, formatDate } from "@/lib/date";

export const metadata: Metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  await requireAdmin();

  const projects = await prisma.project.findMany({
    orderBy: [{ status: "asc" }, { endDate: "asc" }],
    include: {
      client: { select: { id: true, businessName: true } },
      services: { include: { service: { select: { name: true } } } },
      modules: {
        select: {
          milestones: { select: { status: true, dueDate: true } },
        },
      },
    },
  });

  const progress = await progressForProjects(projects.map((project) => project.id));
  const now = new Date();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Delivery"
        title="Engagements"
        description="Every retainer cycle across the agency, and how each one is tracking against its deadlines."
      />

      {projects.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Layers}
            eyebrow="Nothing running"
            title="No engagements yet"
            description="Onboard a client and Agency OS lays out their first month of work automatically."
            action={
              <Link href="/clients" className={buttonClasses("primary", "md")}>
                Go to clients
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const milestones = project.modules.flatMap((module) => module.milestones);
            const overdue = milestones.filter(
              (milestone) =>
                milestone.status !== "COMPLETED" && dueDeadline(milestone.dueDate) < now,
            ).length;
            const bar = progress.get(project.id) ?? { total: 0, done: 0, percent: 0 };
            const remaining = daysUntil(project.endDate);

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-card border border-line bg-white p-5 transition-colors hover:border-ink/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1.5 text-brand">{project.client.businessName}</p>
                    <h2 className="font-display text-base font-bold tracking-tight text-ink">
                      {project.title}
                    </h2>
                    <p className="mt-1 text-[13px] text-ink/50">
                      {formatDate(project.startDate)} – {formatDate(project.endDate)} ·{" "}
                      {remaining < 0
                        ? `${Math.abs(remaining)} days overdue`
                        : `${remaining} days remaining`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {overdue > 0 && (
                      <Badge tone="danger" size="sm">
                        {overdue} overdue
                      </Badge>
                    )}
                    <Badge dot tone={PROJECT_STATUS_TONE[project.status as ProjectStatus]}>
                      {PROJECT_STATUS_LABEL[project.status as ProjectStatus]}
                    </Badge>
                  </div>
                </div>

                <ProgressBar
                  className="mt-4"
                  size="sm"
                  value={bar.percent}
                  tone={overdue > 0 ? "warn" : "brand"}
                />

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] text-ink/40">
                    {bar.done} of {bar.total} milestones complete
                  </p>
                  <p className="text-[12px] text-ink/40">
                    {project.services.map((link) => link.service.name).join(" · ")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
