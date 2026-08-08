"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { WeightDots } from "@/components/ui/WeightDots";
import {
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
} from "@/lib/constants";
import { dueUrgency, formatDate } from "@/lib/date";
import { formatPoints } from "@/lib/scoring";
import { cn } from "@/lib/utils";
import type { MilestoneRow } from "@/lib/types";

export type MemberOption = {
  id: string;
  name: string;
  avatarColor: string;
  jobTitle: string;
};

/**
 * One milestone in the planner.
 *
 * Deadline pressure is shown on the date itself — amber inside 48 hours, red
 * once the deadline has passed and the work isn't approved. The points chip
 * appears only once the scoring engine has actually charged something, so an
 * untouched row stays quiet.
 */
export function MilestoneRowItem({
  milestone,
  members,
  busy,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onAssign,
  onApprove,
  onReject,
  onMove,
}: {
  milestone: MilestoneRow;
  members: MemberOption[];
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: (assigneeId: string | null) => void;
  onApprove: () => void;
  onReject: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [assigning, setAssigning] = useState(false);

  const settled = milestone.status === "COMPLETED";
  const urgency = settled ? "normal" : dueUrgency(milestone.dueDate);

  return (
    <div
      className={cn(
        "group grid grid-cols-1 gap-3 px-4 py-3.5 transition-colors sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center",
        busy && "opacity-60",
        milestone.status === "MISSED" && "bg-danger-tint/40",
      )}
    >
      {/* Title, weight, description */}
      <div className="min-w-0">
        <div className="flex items-start gap-2.5">
          <WeightDots weight={milestone.weight} className="mt-1.5 shrink-0" />
          <div className="min-w-0">
            <p
              className={cn(
                "text-sm font-medium leading-snug text-ink",
                settled && "text-ink/55",
              )}
            >
              {milestone.title}
            </p>
            {milestone.description && (
              <p className="mt-0.5 line-clamp-1 text-[12px] text-ink/45">
                {milestone.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Assignee, due date, status, actions */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
        {/* Assignee — a native select keeps this keyboard-friendly and cheap */}
        <div className="relative">
          {assigning ? (
            <select
              autoFocus
              disabled={busy}
              defaultValue={milestone.assignee?.id ?? ""}
              onBlur={() => setAssigning(false)}
              onChange={(event) => {
                onAssign(event.target.value || null);
                setAssigning(false);
              }}
              className="h-8 rounded-pill border border-line bg-white px-2.5 text-[12px] text-ink focus:border-brand focus:outline-none"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAssigning(true)}
              title="Change assignee"
              className={cn(
                "flex h-8 items-center gap-2 rounded-pill border px-2 pr-3 text-[12px] transition-colors",
                milestone.assignee
                  ? "border-line bg-white text-ink/70 hover:border-ink/25"
                  : "border-dashed border-line text-ink/40 hover:border-ink/25 hover:text-ink/70",
              )}
            >
              {milestone.assignee ? (
                <>
                  <Avatar
                    name={milestone.assignee.name}
                    color={milestone.assignee.avatarColor}
                    size="sm"
                    className="h-5 w-5 text-[9px]"
                  />
                  <span className="max-w-[104px] truncate">
                    {milestone.assignee.name}
                  </span>
                </>
              ) : (
                <span className="px-1">Assign</span>
              )}
            </button>
          )}
        </div>

        {/* Due date */}
        <span
          className={cn(
            "whitespace-nowrap rounded-pill border px-2.5 py-1 text-[12px] tabular-nums",
            urgency === "overdue" && "border-danger/25 bg-danger-tint font-medium text-danger",
            urgency === "soon" && "border-warn/25 bg-warn-tint font-medium text-warn",
            urgency === "normal" && "border-line bg-white text-ink/55",
          )}
          title={
            urgency === "overdue"
              ? "Past its deadline"
              : urgency === "soon"
                ? "Due within 48 hours"
                : undefined
          }
        >
          {formatDate(milestone.dueDate)}
        </span>

        <Badge dot tone={MILESTONE_STATUS_TONE[milestone.status]} size="sm">
          {MILESTONE_STATUS_LABEL[milestone.status]}
        </Badge>

        {/* Points already charged or credited */}
        {milestone.scoreImpact !== 0 && (
          <span
            className={cn(
              "rounded-pill border px-2 py-0.5 text-[11px] font-bold tabular-nums",
              milestone.scoreImpact > 0
                ? "border-brand/20 bg-brand-tint text-brand"
                : "border-danger/20 bg-danger-tint text-danger",
            )}
            title="Points applied to the assignee's score"
          >
            {formatPoints(milestone.scoreImpact)}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          {milestone.status === "SUBMITTED" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onApprove}
                icon={<Check className="h-3.5 w-3.5" />}
                className="text-brand hover:bg-brand-tint"
                title="Approve — this settles the score for this milestone"
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onReject}
                icon={<Undo2 className="h-3.5 w-3.5" />}
                className="text-danger hover:bg-danger-tint"
                title="Send back for rework"
              >
                Reject
              </Button>
            </>
          )}

          <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <IconButton label="Move up" disabled={busy || isFirst} onClick={() => onMove(-1)}>
              <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Move down" disabled={busy || isLast} onClick={() => onMove(1)}>
              <ChevronDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Edit milestone" disabled={busy} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Delete milestone"
              disabled={busy}
              onClick={onDelete}
              tone="danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-[7px] p-1.5 transition-colors disabled:opacity-30",
        tone === "danger"
          ? "text-ink/40 hover:bg-danger-tint hover:text-danger"
          : "text-ink/40 hover:bg-cream hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
