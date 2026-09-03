"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DEPT_ROLES, DEPT_ROLE_LABEL, type DeptRole } from "@/lib/constants";
import { departmentTone } from "@/components/settings/DepartmentsManager";
import type { TeamMember } from "@/lib/types";

type DeptOption = { id: string; name: string; shortLabel: string; colorToken: string | null };
type Draft = { departmentId: string; roleInDept: DeptRole; skills: string[] };

/**
 * One person's departments and skills, edited from the team roster.
 *
 * The same rows Settings → Departments writes, approached from the person
 * rather than the department — which is the direction an admin thinks in when
 * someone changes what they work on.
 */
export function MemberDepartmentsModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<DeptOption[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [skillInput, setSkillInput] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/departments");
      const data = await res.json();
      setOptions(
        (data.departments ?? [])
          .filter((d: { isActive: boolean }) => d.isActive)
          .map((d: DeptOption) => ({
            id: d.id,
            name: d.name,
            shortLabel: d.shortLabel,
            colorToken: d.colorToken,
          })),
      );
    } catch {
      toast.error("Couldn't load departments");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!member) return;
    void load();
    setDrafts(
      member.departments.map((d) => ({
        departmentId: d.departmentId,
        roleInDept: d.roleInDept,
        skills: d.skills,
      })),
    );
    setSkillInput({});
  }, [member, load]);

  if (!member) return null;

  function toggle(departmentId: string) {
    setDrafts((prev) =>
      prev.some((d) => d.departmentId === departmentId)
        ? prev.filter((d) => d.departmentId !== departmentId)
        : [...prev, { departmentId, roleInDept: "MEMBER", skills: [] }],
    );
  }

  function addSkill(departmentId: string) {
    const raw = (skillInput[departmentId] ?? "").trim();
    if (!raw) return;
    setDrafts((prev) =>
      prev.map((d) =>
        d.departmentId === departmentId &&
        !d.skills.some((s) => s.toLowerCase() === raw.toLowerCase())
          ? { ...d, skills: [...d.skills, raw] }
          : d,
      ),
    );
    setSkillInput((prev) => ({ ...prev, [departmentId]: "" }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${member!.id}/departments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberships: drafts }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(`${member!.name}'s departments updated`);
      onSaved();
    } catch {
      toast.error("Couldn't save those departments");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title={`${member.name} — departments`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-card" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="mb-3 text-[13px] leading-relaxed text-ink/55">
            {member.name} sees leads, clients and deals for these departments
            only. Skills are free text.
          </p>

          {options.map((dept) => {
            const draft = drafts.find((d) => d.departmentId === dept.id);
            const active = Boolean(draft);

            return (
              <div
                key={dept.id}
                className={cn(
                  "rounded-card border px-4 py-3 transition-colors",
                  active ? "border-brand/25 bg-brand-tint/40" : "border-line bg-paper",
                )}
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle(dept.id)}
                    className="h-4 w-4 rounded border-line accent-brand"
                  />
                  <Badge tone={departmentTone(dept.colorToken)} size="sm">
                    {dept.shortLabel}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink/70">
                    {dept.name}
                  </span>

                  {active && (
                    <select
                      value={draft!.roleInDept}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((d) =>
                            d.departmentId === dept.id
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
                                  d.departmentId === dept.id
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
                        value={skillInput[dept.id] ?? ""}
                        placeholder="Add a skill…"
                        onChange={(e) =>
                          setSkillInput((prev) => ({ ...prev, [dept.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSkill(dept.id);
                          }
                        }}
                        className="h-8 text-[13px]"
                      />
                      <Button variant="secondary" size="sm" onClick={() => addSkill(dept.id)}>
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
