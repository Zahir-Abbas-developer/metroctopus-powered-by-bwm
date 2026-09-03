"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Building2, Pencil, Plus, Users2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import {
  Table,
  TableShell,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import { DepartmentModal } from "@/components/settings/DepartmentModal";
import { DepartmentMembersModal } from "@/components/settings/DepartmentMembersModal";
import type { BadgeTone } from "@/components/ui/Badge";

export type DepartmentMemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  roleInDept: "LEAD" | "MEMBER";
  skills: string[];
};

export type DepartmentView = {
  id: string;
  slug: string;
  name: string;
  shortLabel: string;
  colorToken: string | null;
  description: string | null;
  order: number;
  isActive: boolean;
  members: DepartmentMemberView[];
  counts: { clients: number; leads: number };
};

/** A department's tone is already a BadgeTone; null falls back to neutral. */
export function departmentTone(colorToken: string | null): BadgeTone {
  const tones: BadgeTone[] = ["success", "info", "warning", "danger", "neutral"];
  return tones.includes(colorToken as BadgeTone) ? (colorToken as BadgeTone) : "neutral";
}

export function DepartmentsManager() {
  const toast = useToast();
  const [departments, setDepartments] = useState<DepartmentView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<DepartmentView | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<DepartmentView | null>(null);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setDepartments(data.departments);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Ordering is arrow-driven rather than pointer-drag.
   *
   * The rail, every department dropdown and the dashboard read this order, and
   * it is edited rarely — a keyboard-reachable control that works identically
   * on a phone beats a drag handle that needs a mouse and a fallback. The whole
   * ordered list is sent, so the server never has to infer what moved.
   */
  async function move(index: number, direction: -1 | 1) {
    const next = [...departments];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDepartments(next);
    setReordering(true);

    try {
      const res = await fetch("/api/departments/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((d) => d.id) }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      toast.error("Couldn't save that order");
      void load();
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Departments"
        description="The business lines this CRM is organised around. Every lead, client and deal belongs to exactly one of them, and each carries its own pipeline stages and client fields."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New department
          </Button>
        }
      />

      {status === "loading" && <Skeleton className="h-64 w-full rounded-card" />}
      {status === "error" && <ErrorState onRetry={() => void load()} />}

      {status === "ready" && departments.length === 0 && (
        <EmptyState
          icon={Building2}
          eyebrow="Departments"
          title="No departments yet"
          description="A department is a business line. Leads, clients and deals all belong to one, so at least one has to exist before the CRM can hold anything."
          action={<Button onClick={() => setCreating(true)}>Add the first one</Button>}
        />
      )}

      {status === "ready" && departments.length > 0 && (
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Department</TH>
                <TH>Team</TH>
                <TH>Records</TH>
                <TH>Status</TH>
                <TH className="text-right">Order</TH>
                <TH className="text-right">Manage</TH>
              </TR>
            </THead>
            <TBody>
              {departments.map((dept, index) => (
                <TR key={dept.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Badge tone={departmentTone(dept.colorToken)}>{dept.shortLabel}</Badge>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{dept.name}</p>
                        {dept.description && (
                          <p className="truncate text-[12px] text-ink/45">{dept.description}</p>
                        )}
                      </div>
                    </div>
                  </TD>

                  <TD>
                    {dept.members.length === 0 ? (
                      <span className="text-[13px] text-ink/40">Nobody yet</span>
                    ) : (
                      <div className="flex items-center -space-x-1.5">
                        {dept.members.slice(0, 5).map((m) => (
                          <Avatar
                            key={m.membershipId}
                            name={m.name}
                            color={m.avatarColor}
                            size="sm"
                          />
                        ))}
                        {dept.members.length > 5 && (
                          <span className="pl-3 text-[12px] text-ink/45">
                            +{dept.members.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </TD>

                  <TD>
                    <span className="text-[13px] tabular-nums text-ink/60">
                      {dept.counts.clients} client{dept.counts.clients === 1 ? "" : "s"} ·{" "}
                      {dept.counts.leads} deal{dept.counts.leads === 1 ? "" : "s"}
                    </span>
                  </TD>

                  <TD>
                    <Badge tone={dept.isActive ? "success" : "neutral"} dot>
                      {dept.isActive ? "Active" : "Off"}
                    </Badge>
                  </TD>

                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${dept.shortLabel} up`}
                        disabled={index === 0 || reordering}
                        onClick={() => void move(index, -1)}
                        className="rounded-[8px] border border-line p-1.5 text-ink/60 transition-colors hover:bg-cream disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${dept.shortLabel} down`}
                        disabled={index === departments.length - 1 || reordering}
                        onClick={() => void move(index, 1)}
                        className="rounded-[8px] border border-line p-1.5 text-ink/60 transition-colors hover:bg-cream disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TD>

                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Users2 className="h-3.5 w-3.5" />}
                        onClick={() => setManaging(dept)}
                      >
                        Team
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => setEditing(dept)}
                      >
                        Edit
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      <DepartmentModal
        open={creating || editing !== null}
        department={editing}
        others={departments.filter((d) => d.id !== editing?.id && d.isActive)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void load();
        }}
      />

      <DepartmentMembersModal
        open={managing !== null}
        department={managing}
        onClose={() => setManaging(null)}
        onSaved={() => {
          setManaging(null);
          void load();
        }}
      />
    </div>
  );
}
