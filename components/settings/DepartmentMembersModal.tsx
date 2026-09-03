"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DEPT_ROLES, DEPT_ROLE_LABEL, type DeptRole } from "@/lib/constants";
import type { DepartmentView } from "@/components/settings/DepartmentsManager";

type Candidate = { id: string; name: string; email: string; avatarColor: string };
type Draft = { userId: string; roleInDept: DeptRole; skills: string[] };

/**
 * Who works in a department, and what they do there.
 *
 * The whole membership list is submitted at once rather than as a series of
 * add/remove calls: two admins editing the same department then converge on a
 * list instead of on a half-applied set of operations.
 */
export function DepartmentMembersModal({
  open,
  department,
  onClose,
  onSaved,
}: {
  open: boolean;
  department: DepartmentView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [people, setPeople] = useState<Candidate[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [skillInput, setSkillInput] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/team");
      const data = await res.json();
      setPeople(
        (data.members ?? []).map((m: Candidate) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          avatarColor: m.avatarColor,
        })),
      );
    } catch {
      toast.error("Couldn't load the team");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open || !department) return;
    void load();
    setDrafts(
      department.members.map((m) => ({
        userId: m.userId,
        roleInDept: m.roleInDept,
        skills: m.skills,
      })),
    );
    setSkillInput({});
  }, [open, department, load]);

  if (!department) return null;

  const inDept = (userId: string) => drafts.some((d) => d.userId === userId);

  function toggleMember(userId: string) {
    setDrafts((prev) =>
      prev.some((d) => d.userId === userId)
        ? prev.filter((d) => d.userId !== userId)
        : [...prev, { userId, roleInDept: "MEMBER", skills: [] }],
    );
  }

  function addSkill(userId: string) {
    const raw = (skillInput[userId] ?? "").trim();
    if (!raw) return;
    setDrafts((prev) =>
      prev.map((d) =>
        d.userId === userId && !d.skills.some((s) => s.toLowerCase() === raw.toLowerCase())
          ? { ...d, skills: [...d.skills, raw] }
          : d,
      ),
    );
    setSkillInput((prev) => ({ ...prev, [userId]: "" }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/departments/${department!.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: drafts }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(`${department!.shortLabel} team updated`);
      onSaved();
    } catch {
      toast.error("Couldn't save that team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`${department.shortLabel} — team`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save team
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="mb-3 text-[13px] leading-relaxed text-ink/55">
            Members see only the departments they belong to. Skills are free
            text — whatever this business line actually needs.
          </p>

          {people.map((person) => {
            const draft = drafts.find((d) => d.userId === person.id);
            const active = Boolean(draft);

            return (
              <div
                key={person.id}
                className={cn(
                  "rounded-card border px-4 py-3 transition-colors",
                  active ? "border-brand/25 bg-brand-tint/40" : "border-line bg-paper",
                )}
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleMember(person.id)}
                    className="h-4 w-4 rounded border-line accent-brand"
                  />
                  <Avatar name={person.name} color={person.avatarColor} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {person.name}
                    </span>
                    <span className="block truncate text-[12px] text-ink/45">
                      {person.email}
                    </span>
                  </span>

                  {active && (
                    <select
                      value={draft!.roleInDept}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((d) =>
                            d.userId === person.id
                              ? { ...d, roleInDept: e.target.value as DeptRole }
                              : d,
                          ),
                        )
                      }
                      className="rounded-[8px] border border-line bg-paper px-2 py-1 text-[12px] text-ink/70"
                    >
                      {DEPT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {DEPT_ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                {active && (
                  <div className="mt-3 border-t border-line/70 pl-7 pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {draft!.skills.map((skill) => (
                        <span
                          key={skill}
                          className="inline-flex items-center gap-1 rounded-pill border border-line bg-paper px-2 py-0.5 text-[12px] text-ink/70"
                        >
                          {skill}
                          <button
                            type="button"
                            aria-label={`Remove ${skill}`}
                            onClick={() =>
                              setDrafts((prev) =>
                                prev.map((d) =>
                                  d.userId === person.id
                                    ? { ...d, skills: d.skills.filter((s) => s !== skill) }
                                    : d,
                                ),
                              )
                            }
                            className="text-ink/35 transition-colors hover:text-danger"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      {draft!.skills.length === 0 && (
                        <span className="text-[12px] text-ink/40">No skills recorded</span>
                      )}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <Input
                        value={skillInput[person.id] ?? ""}
                        placeholder="Add a skill…"
                        onChange={(e) =>
                          setSkillInput((prev) => ({ ...prev, [person.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSkill(person.id);
                          }
                        }}
                        className="h-8 text-[13px]"
                      />
                      <Button variant="secondary" size="sm" onClick={() => addSkill(person.id)}>
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {people.length > 0 && (
            <p className="pt-2 text-[12px] text-ink/45">
              <Badge tone="neutral">{drafts.length}</Badge> of {people.length} people
              assigned.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
