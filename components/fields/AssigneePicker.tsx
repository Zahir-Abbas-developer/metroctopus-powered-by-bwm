"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AssignableMember } from "@/lib/assignment";
import { cn } from "@/lib/utils";

/**
 * Who gets this record.
 *
 * A native `<select>` would be the smaller change, but it cannot carry the two
 * things that make this decision well: the reason someone is recommended, and
 * what they are already carrying. So this is a radio group — still one value,
 * still keyboard-reachable, drawn with the existing `Avatar` and `Badge` at the
 * same pill weight used for statuses elsewhere.
 *
 * The list is the department's members and nobody else. Ranking is a hint, not
 * a filter: the best-fit people are on top, and every member stays pickable,
 * because whoever knows why this deal is different outranks the scoring.
 */
export function AssigneePicker({
  members,
  value,
  onChange,
  label = "Assign to",
  emptyHint,
}: {
  members: readonly AssignableMember[];
  value: string;
  onChange: (userId: string) => void;
  label?: string;
  emptyHint?: string;
}) {
  if (members.length === 0) {
    return (
      <EmptyState
        title="Nobody is in this department yet"
        description={
          emptyHint ??
          "An admin can add members in Settings → Departments before work is filed here."
        }
      />
    );
  }

  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-ink/80">{label}</legend>

      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
        {members.map((member) => {
          const selected = value === member.userId;

          return (
            <label
              key={member.userId}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors",
                selected ? "bg-brand-tint" : "hover:bg-cream",
              )}
            >
              <input
                type="radio"
                name="assignee"
                className="h-4 w-4 border-line text-brand focus:ring-brand/25"
                checked={selected}
                onChange={() => onChange(member.userId)}
              />

              <Avatar name={member.name} color={member.avatarColor} size="sm" />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{member.name}</span>
                  {member.recommended && (
                    <Badge tone="success" size="sm">
                      Recommended
                    </Badge>
                  )}
                  {member.roleInDept === "LEAD" && (
                    <Badge tone="neutral" size="sm">
                      Dept lead
                    </Badge>
                  )}
                </span>

                {member.matchedSkills.length > 0 && (
                  <span className="mt-0.5 block truncate text-[12px] text-ink/50">
                    {member.matchedSkills.join(" · ")}
                  </span>
                )}
              </span>

              {/* Load at the moment of assignment — the number that stops every
                  new lead landing on whoever comes first alphabetically. */}
              <span className="shrink-0 text-[12px] text-ink/45">
                {member.openLeads === 0
                  ? "no open leads"
                  : `${member.openLeads} open`}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
