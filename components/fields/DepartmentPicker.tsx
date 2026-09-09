"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { CreatableDepartment } from "@/lib/departments";
import type { BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

/**
 * Step 1 of every creation flow: which business line is this?
 *
 * It comes first because everything after it depends on the answer — the
 * questions asked, the stages available, and who may be assigned. Asking it
 * last would mean re-rendering the form underneath the user.
 *
 * The list is what the *viewer* may file under, so a member with two
 * departments sees two cards. That is the department scoping rule at the point
 * of creation, and the payload behind it carries only those two as well.
 */
export function DepartmentPicker({
  departments,
  value,
  onChange,
}: {
  departments: readonly CreatableDepartment[];
  value: string;
  onChange: (departmentId: string) => void;
}) {
  if (departments.length === 0) {
    return (
      <EmptyState
        title="You're not in a department yet"
        description="Records belong to a business line, so an admin needs to add you to one before you can create anything."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {departments.map((department) => {
        const selected = value === department.id;

        return (
          <button
            key={department.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(department.id)}
            className={cn(
              "rounded-card border p-4 text-left transition-colors",
              selected
                ? "border-brand bg-brand-tint"
                : "border-line bg-white hover:border-ink/25",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-display text-[15px] font-bold leading-tight text-ink">
                {department.name}
              </span>
              <Badge tone={toneFor(department.colorToken)} size="sm">
                {department.shortLabel}
              </Badge>
            </div>

            {department.description && (
              <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink/55">
                {department.description}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              {/* Who works this line — the fastest way to recognise the right
                  department without reading four descriptions. */}
              <div className="flex -space-x-1.5">
                {department.members.slice(0, 5).map((member) => (
                  <Avatar
                    key={member.id}
                    name={member.name}
                    color={member.avatarColor}
                    size="sm"
                    className="ring-2 ring-white"
                  />
                ))}
              </div>
              <span className="text-[12px] text-ink/45">
                {department.members.length === 0
                  ? "no members yet"
                  : department.members.length === 1
                    ? "1 member"
                    : `${department.members.length} members`}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** A department's stored colour token, mapped onto the Badge tones. */
function toneFor(colorToken: string | null): BadgeTone {
  const tones: readonly BadgeTone[] = ["success", "warning", "danger", "info", "neutral"];
  return tones.includes((colorToken ?? "") as BadgeTone)
    ? (colorToken as BadgeTone)
    : "neutral";
}
