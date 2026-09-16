"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  KeyRound,
  Pencil,
  RotateCcw,
  UserPlus,
  UserX,
  Users2,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { VolumeFootnote } from "@/components/ui/PerformanceBadge";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { UtilizationGrid } from "@/components/capacity/UtilizationGrid";
import { ServiceLeadPanel } from "@/components/team/ServiceLeadPanel";
import {
  Table,
  TableShell,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import { MemberStatusModal } from "@/components/team/MemberStatusModal";
import { TeamMemberModal } from "@/components/team/TeamMemberModal";
import { ResetPasswordModal } from "@/components/team/ResetPasswordModal";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/types";
import { hasAdminPower } from "@/lib/constants";
import { departmentTone } from "@/components/settings/DepartmentsManager";
import { MemberDepartmentsModal } from "@/components/team/MemberDepartmentsModal";

type Status = "loading" | "ready" | "error";
/**
 * The doctrine's triple is sortable on all three axes, and the default is
 * on-time rate rather than score: the raw number is the least comparable of
 * the three, so opening the page ranked by it invites exactly the comparison
 * the doctrine is trying to prevent.
 */
type SortKey = "name" | "score" | "onTime" | "load" | "joined";

export function TeamManager({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<"roster" | "leads" | "utilization">("roster");
  const [editingDepartments, setEditingDepartments] = useState<TeamMember | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "onTime",
    desc: true,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [statusTarget, setStatusTarget] = useState<TeamMember | null>(null);
  const [resetTarget, setResetTarget] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/team", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as { members: TeamMember[] };
      setMembers(body.members);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function onSaved(message: string) {
    setFormOpen(false);
    setEditing(null);
    setStatusTarget(null);
    toast.success(message);
    void load();
  }

  const active = members.filter((member) => member.isActive);
  const admins = active.filter((member) => hasAdminPower(member.role));

  const sorted = useMemo(() => {
    const rows = [...members];
    rows.sort((a, b) => {
      // Deactivated members always sink, whatever the sort.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;

      const direction = sort.desc ? -1 : 1;
      if (sort.key === "score") return (a.score - b.score) * direction;
      // Unrated members sort last in either direction rather than reading as
      // the worst performers.
      if (sort.key === "onTime") {
        if (a.onTimeRate === null && b.onTimeRate === null) return a.name.localeCompare(b.name);
        if (a.onTimeRate === null) return 1;
        if (b.onTimeRate === null) return -1;
        return (a.onTimeRate - b.onTimeRate) * direction;
      }
      if (sort.key === "load") return (a.load - b.load) * direction;
      if (sort.key === "joined") {
        return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * direction;
      }
      return a.name.localeCompare(b.name) * direction;
    });
    return rows;
  }, [members, sort]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        // Scores worst-first, rates and loads best-first, names A–Z.
        : { key, desc: key === "score" ? true : key === "onTime" || key === "load" },
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="People"
        title="Your team"
        description="Everyone with access to the workspace. Deactivate rather than delete — past work stays attributed."
        actions={
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
            Add member
          </Button>
        }
      />

      <Tabs
        items={[
          { key: "roster", label: "Roster" },
          { key: "leads", label: "Service leads" },
          { key: "utilization", label: "Utilization" },
        ]}
        active={view}
        onChange={setView}
      />

      {view === "leads" && <ServiceLeadPanel />}

      {view === "utilization" && <UtilizationGrid />}

      {view === "roster" && (
        <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active members"
          value={active.length}
          icon={Users2}
          tone="success"
          loading={status === "loading"}
          hint="Able to sign in and take assignments"
        />
        <StatCard
          label="Owners"
          value={admins.length}
          tone="info"
          loading={status === "loading"}
          hint="Full access to every client and report"
        />
        <StatCard
          label="Deactivated"
          value={members.length - active.length}
          tone="neutral"
          loading={status === "loading"}
          hint="Access revoked, history retained"
        />
      </div>

      {status === "loading" && (
        <TableShell>
          <div className="divide-y divide-line">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-9 w-9 rounded-pill" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="hidden h-4 w-32 sm:block" />
                <Skeleton className="hidden h-6 w-20 rounded-pill md:block" />
              </div>
            ))}
          </div>
        </TableShell>
      )}

      {status === "error" && (
        <TableShell>
          <ErrorState
            title="Couldn't load your team"
            description="The team list didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </TableShell>
      )}

      {status === "ready" && members.length === 0 && (
        <TableShell>
          <EmptyState
            icon={Users2}
            eyebrow="No one here yet"
            title="Your team is empty"
            description="Add your designers, marketers and developers so work can be assigned to them automatically."
            action={
              <Button
                icon={<UserPlus className="h-4 w-4" />}
                onClick={() => setFormOpen(true)}
              >
                Add your first member
              </Button>
            }
          />
        </TableShell>
      )}

      {status === "ready" && members.length > 0 && (
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH aria-sort={sort.key === "name" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <SortHeader
                    label="Member"
                    active={sort.key === "name"}
                    desc={sort.desc}
                    onClick={() => toggleSort("name")}
                  />
                </TH>
                <TH>Departments</TH>
                <TH aria-sort={sort.key === "score" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <SortHeader
                    label="Score"
                    active={sort.key === "score"}
                    desc={sort.desc}
                    onClick={() => toggleSort("score")}
                  />
                </TH>
                <TH aria-sort={sort.key === "onTime" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <SortHeader
                    label="On time"
                    active={sort.key === "onTime"}
                    desc={sort.desc}
                    onClick={() => toggleSort("onTime")}
                  />
                </TH>
                <TH aria-sort={sort.key === "load" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <SortHeader
                    label="Load"
                    active={sort.key === "load"}
                    desc={sort.desc}
                    onClick={() => toggleSort("load")}
                  />
                </TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH aria-sort={sort.key === "joined" ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <SortHeader
                    label="Joined"
                    active={sort.key === "joined"}
                    desc={sort.desc}
                    onClick={() => toggleSort("joined")}
                  />
                </TH>
                {/* Pinned to the right edge. The table is nine columns wide, so on
                    a phone the actions sat far off-screen behind a sideways
                    scroll, and the only way to reset a password looked like it
                    did not exist. */}
                <TH className="sticky right-0 z-10 bg-cream text-right shadow-[-8px_0_8px_-8px_rgba(12,12,10,0.15)]">
                  Actions
                </TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((member) => {
                const isSelf = member.id === currentUserId;

                return (
                  <TR key={member.id} muted={!member.isActive}>
                    <TD>
                      <Link
                        href={`/team/${member.id}`}
                        className="group/name flex items-center gap-3"
                      >
                        <Avatar name={member.name} color={member.avatarColor} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium text-ink group-hover/name:text-brand">
                            {member.name}
                            {isSelf && (
                              <span className="text-[11px] font-normal text-ink/40">
                                you
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[13px] text-ink/50">
                            {member.email}
                          </p>
                        </div>
                      </Link>
                    </TD>

                    {/* Departments replace the old job title column.
                        Membership is the real mapping now — a title was a
                        free-text guess at the same thing. */}
                    <TD>
                      {member.departments.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => setEditingDepartments(member)}
                          className="text-[13px] text-ink/40 underline decoration-line hover:text-ink/70"
                        >
                          None — assign
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingDepartments(member)}
                          aria-label={`Edit ${member.name}'s departments`}
                          className="group/dept max-w-[260px] text-left"
                        >
                          <span className="flex flex-wrap gap-1">
                            {member.departments.map((dept) => (
                              <Badge
                                key={dept.departmentId}
                                tone={departmentTone(dept.colorToken)}
                                size="sm"
                              >
                                {dept.shortLabel}
                                {dept.roleInDept === "LEAD" && " · Lead"}
                              </Badge>
                            ))}
                          </span>
                          {(() => {
                            const skills = Array.from(
                              new Set(member.departments.flatMap((d) => d.skills)),
                            );
                            return skills.length > 0 ? (
                              <span className="mt-1 block truncate text-[12px] text-ink/45 group-hover/dept:text-ink/65">
                                {skills.join(" · ")}
                              </span>
                            ) : null;
                          })()}
                        </button>
                      )}
                    </TD>

                    {/* Score, on-time and load are three columns rather than
                        one cell, so the triple is legible down the page as
                        well as across the row — and each is sortable. */}
                    <TD>
                      <Link
                        href={`/team/${member.id}`}
                        className="flex items-center gap-2.5"
                        title={`${member.score} points this month`}
                      >
                        <ScoreRing score={member.score} size="xs" showValue={false} />
                        <span className="font-display text-sm font-bold tabular-nums text-ink">
                          {member.score}
                        </span>
                        {member.trend !== null && Math.abs(member.trend) >= 0.05 && (
                          <span
                            className={cn(
                              "text-[11px] font-medium tabular-nums",
                              member.trend > 0 ? "text-brand" : "text-danger",
                            )}
                          >
                            {member.trend > 0 ? "+" : "−"}
                            {Math.abs(member.trend).toFixed(1)}
                          </span>
                        )}
                      </Link>
                    </TD>

                    <TD>
                      <span
                        className={cn(
                          "text-sm tabular-nums",
                          member.onTimeRate === null
                            ? "text-ink/30"
                            : member.onTimeRate >= 90
                              ? "text-brand"
                              : member.onTimeRate >= 70
                                ? "text-ink/70"
                                : "text-danger",
                        )}
                      >
                        {member.onTimeRate === null ? "—" : `${member.onTimeRate}%`}
                      </span>
                    </TD>

                    <TD>
                      <span className="text-sm tabular-nums text-ink/70">
                        {member.load}
                      </span>
                      {member.load > 0 && (
                        <span className="ml-1 text-[11px] text-ink/35">
                          · w{member.totalWeight}
                        </span>
                      )}
                    </TD>

                    <TD>
                      <Badge tone={hasAdminPower(member.role) ? "info" : "neutral"}>
                        {member.role === "ADMIN"
                          ? "Owner"
                          : member.role === "SUPPORT_ADMIN"
                            ? "Support"
                            : "Member"}
                      </Badge>
                    </TD>

                    <TD>
                      <Badge dot tone={member.isActive ? "success" : "danger"}>
                        {member.isActive ? "Active" : "Deactivated"}
                      </Badge>
                    </TD>

                    <TD className="whitespace-nowrap text-ink/60">
                      {formatDate(member.createdAt)}
                    </TD>

                    <TD
                      className={cn(
                        "sticky right-0 z-10 shadow-[-8px_0_8px_-8px_rgba(12,12,10,0.15)]",
                        member.isActive ? "bg-white" : "bg-paper",
                      )}
                    >
                      {/* Labels from sm up; icons alone below, with the label kept
                          for screen readers, so the pinned column stays narrow. */}
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="h-3.5 w-3.5" />}
                          aria-label={`Edit ${member.name}`}
                          onClick={() => {
                            setEditing(member);
                            setFormOpen(true);
                          }}
                        >
                          <span className="hidden sm:inline">Edit</span>
                        </Button>

                        {!isSelf && member.isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<KeyRound className="h-3.5 w-3.5" />}
                            aria-label={`Reset ${member.name}'s password`}
                            onClick={() => setResetTarget(member)}
                          >
                            <span className="hidden sm:inline">Reset password</span>
                          </Button>
                        )}

                        {/* The owner can't switch off their own access. */}
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={
                              member.isActive ? (
                                <UserX className="h-3.5 w-3.5" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )
                            }
                            onClick={() => setStatusTarget(member)}
                            aria-label={`${member.isActive ? "Deactivate" : "Restore"} ${member.name}`}
                            className={member.isActive ? "hover:text-danger" : "hover:text-brand"}
                          >
                            <span className="hidden sm:inline">
                              {member.isActive ? "Deactivate" : "Restore"}
                            </span>
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          <div className="border-t border-line px-5 py-3">
            <VolumeFootnote />
          </div>
        </TableShell>
      )}
        </>
      )}

      <MemberDepartmentsModal
        member={editingDepartments}
        onClose={() => setEditingDepartments(null)}
        onSaved={() => {
          setEditingDepartments(null);
          void load();
        }}
      />

      <TeamMemberModal
        open={formOpen}
        member={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={onSaved}
      />

      <ResetPasswordModal
        member={resetTarget}
        onClose={() => setResetTarget(null)}
        onReset={() => void load()}
      />

      <MemberStatusModal
        member={statusTarget}
        onClose={() => setStatusTarget(null)}
        onSaved={onSaved}
      />
    </div>
  );
}

function SortHeader({
  label,
  active,
  desc,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  const Icon = desc ? ArrowDown : ArrowUp;
  const direction = desc ? "descending" : "ascending";

  return (
    <button
      type="button"
      onClick={onClick}
      // aria-sort belongs on the column header cell, not the button — the TH
      // carries it. The button just announces what pressing it will do.
      aria-label={`Sort by ${label}, currently ${active ? direction : "unsorted"}`}
      className={cn(
        "eyebrow flex items-center gap-1 transition-colors",
        active ? "text-ink/70" : "text-ink/50 hover:text-ink/70",
      )}
    >
      {label}
      <Icon
        aria-hidden
        className={cn("h-3 w-3 transition-opacity", active ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}
