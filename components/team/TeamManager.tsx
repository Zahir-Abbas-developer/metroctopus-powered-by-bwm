"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Pencil, RotateCcw, UserPlus, UserX, Users2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
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
import { formatDate } from "@/lib/date";
import type { TeamMember } from "@/lib/types";

type Status = "loading" | "ready" | "error";

export function TeamManager({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [flash, setFlash] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [statusTarget, setStatusTarget] = useState<TeamMember | null>(null);

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

  // Success banners fade out on their own so the table stays the focus.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  function onSaved(message: string) {
    setFormOpen(false);
    setEditing(null);
    setStatusTarget(null);
    setFlash(message);
    void load();
  }

  const active = members.filter((member) => member.isActive);
  const admins = active.filter((member) => member.role === "ADMIN");

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

      {flash && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-card border border-brand/20 bg-brand-tint px-4 py-3 text-[13px] leading-relaxed text-brand"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{flash}</span>
        </div>
      )}

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
                <TH>Member</TH>
                <TH>Job title</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Joined</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((member) => {
                const isSelf = member.id === currentUserId;

                return (
                  <TR key={member.id} muted={!member.isActive}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.name} color={member.avatarColor} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium text-ink">
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
                      </div>
                    </TD>

                    <TD className="text-ink/70">{member.jobTitle}</TD>

                    <TD>
                      <Badge tone={member.role === "ADMIN" ? "info" : "neutral"}>
                        {member.role === "ADMIN" ? "Owner" : "Member"}
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

                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setEditing(member);
                            setFormOpen(true);
                          }}
                        >
                          Edit
                        </Button>

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
                            className={member.isActive ? "hover:text-danger" : "hover:text-brand"}
                          >
                            {member.isActive ? "Deactivate" : "Restore"}
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableShell>
      )}

      <TeamMemberModal
        open={formOpen}
        member={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={onSaved}
      />

      <MemberStatusModal
        member={statusTarget}
        onClose={() => setStatusTarget(null)}
        onSaved={onSaved}
      />
    </div>
  );
}
