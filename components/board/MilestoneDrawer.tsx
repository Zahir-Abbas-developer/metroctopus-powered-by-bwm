"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clock3,
  FileText,
  History,
  ImageIcon,
  MessageSquare,
  Paperclip,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { WeightDots } from "@/components/ui/WeightDots";
import { useToast } from "@/components/ui/Toast";
import { ApproveDialog, QualityStars } from "@/components/quality/ApproveDialog";
import { BlockControl } from "@/components/board/BlockControl";
import { CommentComposer, type MentionMember } from "@/components/board/CommentComposer";
import {
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
  allowedTransitions,
  type MilestoneStatus,
  type Role,
} from "@/lib/constants";
import { dueUrgency, formatDate, formatDateTime, relativeFromNow } from "@/lib/date";
import { formatPoints } from "@/lib/scoring";
import { segmentMentions } from "@/lib/mentions";
import { ACTIVITY_TONE, type ActivityType } from "@/lib/activity";
import { cn, formatBytes } from "@/lib/utils";

type Detail = {
  milestone: {
    id: string;
    title: string;
    description: string | null;
    weight: number;
    dueDate: string;
    status: MilestoneStatus;
    submittedAt: string | null;
    completedAt: string | null;
    assignee: { id: string; name: string; avatarColor: string; jobTitle: string } | null;
    moduleName: string;
    projectId: string;
    projectTitle: string;
    clientName: string;
    scoreImpact: number;
    blockedReason: string | null;
    blockedNote: string | null;
    blockedSince: string | null;
    blockedMinutes: number;
    adminReviewMinutes: number | null;
    qualityRating: number | null;
    qualityComment: string | null;
  };
  comments: {
    id: string;
    body: string;
    parentId: string | null;
    createdAt: string;
    author: { id: string; name: string; avatarColor: string };
    mentionedIds: string[];
  }[];
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: string;
    uploader: { id: string; name: string };
    isImage: boolean;
    url: string;
  }[];
  activity: {
    id: string;
    type: ActivityType;
    summary: string;
    detail: string | null;
    createdAt: string;
    actor: { id: string; name: string; avatarColor: string } | null;
  }[];
  members: MentionMember[];
};

type Tab = "details" | "comments" | "files" | "activity";

/**
 * The milestone record, opened alongside the board.
 *
 * This is the screen meant to replace the scattered chat thread: the work, the
 * conversation about it, the files, and an audit trail of what happened, in
 * one place that is attached to the deliverable rather than to a channel.
 */
export function MilestoneDrawer({
  milestoneId,
  viewerId,
  viewerRole,
  onClose,
  onChanged,
}: {
  milestoneId: string | null;
  viewerId: string;
  viewerRole: Role;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("details");
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!milestoneId) return;
    setState("loading");
    try {
      const response = await fetch(`/api/milestones/${milestoneId}/detail`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Detail);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [milestoneId]);

  useEffect(() => {
    if (!milestoneId) {
      setData(null);
      return;
    }
    setTab("details");
    setReplyTo(null);
    void load();
  }, [milestoneId, load]);

  const threads = useMemo(() => {
    if (!data) return [];
    const roots = data.comments.filter((comment) => !comment.parentId);
    return roots.map((root) => ({
      root,
      replies: data.comments.filter((comment) => comment.parentId === root.id),
    }));
  }, [data]);

  async function move(
    to: MilestoneStatus,
    extra: { reason?: string; qualityRating?: number; qualityComment?: string } | string = {},
  ) {
    if (!data) return;
    setBusy(true);

    // Callers that pass a bare string mean a rejection reason.
    const payload = typeof extra === "string" ? { reason: extra } : extra;

    try {
      const response = await fetch(`/api/milestones/${data.milestone.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, ...payload }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(`Moved to ${MILESTONE_STATUS_LABEL[to]}.`);
      setApproving(false);
      await load();
      onChanged();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function postComment(body: string, parentId: string | null) {
    if (!data) return;
    setBusy(true);

    try {
      const response = await fetch(`/api/milestones/${data.milestone.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentId }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(result?.error ?? "Couldn't post that comment.");
        return;
      }

      toast.success(
        result.notified > 0
          ? `Comment posted — ${result.notified} ${result.notified === 1 ? "person" : "people"} notified.`
          : "Comment posted.",
      );
      setReplyTo(null);
      await load();
      onChanged();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!data) return;
    setBusy(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch(`/api/milestones/${data.milestone.id}/attachments`, {
        method: "POST",
        body: form,
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(result?.error ?? "Couldn't upload that file.");
        return;
      }

      toast.success(`${file.name} attached.`);
      await load();
      onChanged();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeAttachment(id: string, filename: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't remove that file.");
        return;
      }
      toast.success(`${filename} removed.`);
      await load();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const milestone = data?.milestone;
  const transitions = milestone
    ? allowedTransitions(viewerRole, milestone.status)
    : [];

  return (
    <Drawer
      open={Boolean(milestoneId)}
      onClose={onClose}
      eyebrow={milestone ? `${milestone.clientName} · ${milestone.moduleName}` : "Milestone"}
      title={milestone?.title ?? "Loading…"}
      footer={
        milestone && transitions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {transitions.map((to) => {
              const isApprove = to === "COMPLETED";
              const isReject = milestone.status === "SUBMITTED" && to === "IN_PROGRESS";

              return (
                <Button
                  key={to}
                  size="sm"
                  variant={isApprove ? "primary" : isReject ? "danger" : "secondary"}
                  disabled={busy}
                  icon={
                    isApprove ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isReject ? (
                      <Undo2 className="h-3.5 w-3.5" />
                    ) : undefined
                  }
                  onClick={() => {
                    // Approving means rating the work, so it opens a dialog
                    // rather than firing straight at the API.
                    if (isApprove) {
                      setApproving(true);
                      return;
                    }
                    if (isReject) {
                      const reason = window.prompt(
                        "What needs reworking? The member is charged points for this.",
                      );
                      if (!reason || reason.trim().length < 5) {
                        toast.error("A rejection needs a written reason.");
                        return;
                      }
                      void move(to, reason.trim());
                      return;
                    }
                    void move(to);
                  }}
                >
                  {isApprove ? "Approve" : isReject ? "Reject" : MILESTONE_STATUS_LABEL[to]}
                </Button>
              );
            })}
          </div>
        ) : undefined
      }
    >
      <ApproveDialog
        open={approving}
        title={milestone?.title ?? ""}
        memberName={milestone?.assignee?.name ?? null}
        busy={busy}
        onClose={() => setApproving(false)}
        onApprove={async (qualityRating, qualityComment) => {
          await move("COMPLETED", { qualityRating, qualityComment });
        }}
      />

      {state === "loading" && (
        <div className="space-y-3 p-5">
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      )}

      {state === "error" && (
        <ErrorState
          title="Couldn't open this milestone"
          description="It may have been removed, or the request failed."
          onRetry={() => void load()}
        />
      )}

      {state === "ready" && data && milestone && (
        <>
          <div className="border-b border-line bg-white px-5 pb-0 pt-1">
            <Tabs
              items={[
                { key: "details", label: "Details" },
                { key: "comments", label: "Comments", count: data.comments.length },
                { key: "files", label: "Files", count: data.attachments.length },
                { key: "activity", label: "Activity", count: data.activity.length },
              ]}
              active={tab}
              onChange={setTab}
              className="border-b-0"
            />
          </div>

          {tab === "details" && (
            <div className="space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge dot tone={MILESTONE_STATUS_TONE[milestone.status]}>
                  {MILESTONE_STATUS_LABEL[milestone.status]}
                </Badge>
                <span
                  className={cn(
                    "rounded-pill border px-2.5 py-1 text-[12px]",
                    dueUrgency(milestone.dueDate) === "overdue" && milestone.status !== "COMPLETED"
                      ? "border-danger/25 bg-danger-tint font-medium text-danger"
                      : dueUrgency(milestone.dueDate) === "soon" && milestone.status !== "COMPLETED"
                        ? "border-warn/25 bg-warn-tint font-medium text-warn"
                        : "border-line bg-white text-ink/55",
                  )}
                >
                  Due {formatDate(milestone.dueDate)}
                </span>
                {milestone.scoreImpact !== 0 && (
                  <span
                    className={cn(
                      "rounded-pill border px-2 py-0.5 text-[11px] font-bold tabular-nums",
                      milestone.scoreImpact > 0
                        ? "border-brand/20 bg-brand-tint text-brand"
                        : "border-danger/20 bg-danger-tint text-danger",
                    )}
                  >
                    {formatPoints(milestone.scoreImpact)}
                  </span>
                )}
              </div>

              {milestone.description && (
                <p className="text-sm leading-relaxed text-ink/70">
                  {milestone.description}
                </p>
              )}

              <dl className="space-y-3 rounded-card border border-line bg-white p-4 text-sm">
                <Row label="Assignee">
                  {milestone.assignee ? (
                    <span className="flex items-center gap-2">
                      <Avatar
                        name={milestone.assignee.name}
                        color={milestone.assignee.avatarColor}
                        size="sm"
                        className="h-6 w-6 text-[9px]"
                      />
                      {milestone.assignee.name}
                    </span>
                  ) : (
                    <span className="text-ink/40">Unassigned</span>
                  )}
                </Row>
                <Row label="Weight">
                  <span className="flex items-center gap-2">
                    <WeightDots weight={milestone.weight} />
                    <span className="text-ink/55">{milestone.weight} of 5</span>
                  </span>
                </Row>
                <Row label="Workstream">{milestone.moduleName}</Row>
                <Row label="Engagement">
                  {viewerRole === "ADMIN" ? (
                    <Link
                      href={`/projects/${milestone.projectId}`}
                      className="text-ink hover:text-brand"
                    >
                      {milestone.projectTitle}
                    </Link>
                  ) : (
                    milestone.projectTitle
                  )}
                </Row>
                {milestone.submittedAt && (
                  <Row label="Submitted">{formatDateTime(milestone.submittedAt)}</Row>
                )}
                {milestone.completedAt && (
                  <Row label="Approved">{formatDateTime(milestone.completedAt)}</Row>
                )}
                {milestone.qualityRating !== null && (
                  <Row label="Quality">
                    <span className="inline-flex items-center gap-2">
                      <QualityStars rating={milestone.qualityRating} />
                      {milestone.qualityComment && (
                        <span className="text-ink/55">{milestone.qualityComment}</span>
                      )}
                    </span>
                  </Row>
                )}
                {/* The owner's own clock, shown only to the owner. */}
                {viewerRole === "ADMIN" && milestone.adminReviewMinutes !== null && (
                  <Row label="Your review took">
                    {milestone.adminReviewMinutes < 60
                      ? `${milestone.adminReviewMinutes} min`
                      : `${Math.round((milestone.adminReviewMinutes / 60) * 10) / 10} h`}
                  </Row>
                )}
              </dl>

              {/* Blocking lives with the facts rather than the footer: it is a
                  statement about the work, not a workflow transition. */}
              {milestone.status !== "COMPLETED" && milestone.status !== "MISSED" && (
                <div className="mt-4">
                  <BlockControl
                    milestoneId={milestone.id}
                    status={milestone.status}
                    blockedReason={milestone.blockedReason}
                    blockedNote={milestone.blockedNote}
                    blockedMinutes={milestone.blockedMinutes}
                    dueDate={milestone.dueDate}
                    viewerIsAdmin={viewerRole === "ADMIN"}
                    onChanged={() => {
                      void load();
                      onChanged();
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "comments" && (
            <div className="space-y-5 p-5">
              <CommentComposer
                members={data.members}
                submitting={busy}
                onSubmit={(body) => void postComment(body, null)}
              />

              {threads.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No comments yet"
                  description="Keep the discussion about this deliverable here, rather than in a chat thread nobody can find later."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-4">
                  {threads.map(({ root, replies }) => (
                    <li key={root.id} className="rounded-card border border-line bg-white p-4">
                      <CommentBody comment={root} members={data.members} viewerId={viewerId} />

                      {replies.length > 0 && (
                        <ul className="mt-3 space-y-3 border-l border-line pl-4">
                          {replies.map((reply) => (
                            <li key={reply.id}>
                              <CommentBody
                                comment={reply}
                                members={data.members}
                                viewerId={viewerId}
                              />
                            </li>
                          ))}
                        </ul>
                      )}

                      {replyTo === root.id ? (
                        <div className="mt-3">
                          <CommentComposer
                            autoFocus
                            members={data.members}
                            submitting={busy}
                            placeholder="Reply…"
                            onSubmit={(body) => void postComment(body, root.id)}
                            onCancel={() => setReplyTo(null)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReplyTo(root.id)}
                          className="mt-2.5 text-[12px] text-ink/45 transition-colors hover:text-ink"
                        >
                          Reply
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "files" && (
            <div className="space-y-4 p-5">
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />

              <button
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-7 text-center transition-colors hover:border-ink/25 hover:bg-cream/50 disabled:opacity-50"
              >
                <Upload className="h-5 w-5 text-ink/35" />
                <span className="text-[13px] font-medium text-ink/70">
                  Upload a file
                </span>
                <span className="text-[12px] text-ink/40">
                  Images, PDFs, documents and archives, up to 10 MB
                </span>
              </button>

              {data.attachments.length === 0 ? (
                <EmptyState
                  icon={Paperclip}
                  title="No files yet"
                  description="Designs, exports and briefs belong on the milestone they're for."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2.5">
                  {data.attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="flex items-center gap-3 rounded-card border border-line bg-white p-3"
                    >
                      {attachment.isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={attachment.url}
                          alt={attachment.filename}
                          className="h-12 w-12 shrink-0 rounded-[8px] border border-line object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-line bg-cream text-ink/45">
                          <FileText className="h-5 w-5" />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                        >
                          {attachment.filename}
                        </a>
                        <p className="mt-0.5 truncate text-[12px] text-ink/45">
                          {formatBytes(attachment.size)} · {attachment.uploader.name} ·{" "}
                          {formatDate(attachment.createdAt)}
                        </p>
                      </div>

                      {(viewerRole === "ADMIN" || attachment.uploader.id === viewerId) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeAttachment(attachment.id, attachment.filename)}
                          aria-label={`Remove ${attachment.filename}`}
                          className="rounded-[7px] p-1.5 text-ink/35 transition-colors hover:bg-danger-tint hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="p-5">
              {data.activity.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="Nothing logged yet"
                  description="Status changes, reassignments, deadline moves and score events all appear here automatically."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-3">
                  {data.activity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-pill",
                          ACTIVITY_TONE[entry.type] === "danger" && "bg-danger",
                          ACTIVITY_TONE[entry.type] === "warning" && "bg-warn",
                          ACTIVITY_TONE[entry.type] === "info" && "bg-info",
                          ACTIVITY_TONE[entry.type] === "neutral" && "bg-ink/25",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-ink/80">
                          <span className="font-medium text-ink">
                            {entry.actor?.name ?? "Agency OS"}
                          </span>{" "}
                          {entry.summary}
                        </p>
                        {entry.detail && (
                          <p className="mt-0.5 text-[12px] leading-relaxed text-ink/45">
                            {entry.detail}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-ink/35">
                          {relativeFromNow(entry.createdAt)} · {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

function CommentBody({
  comment,
  members,
  viewerId,
}: {
  comment: Detail["comments"][number];
  members: MentionMember[];
  viewerId: string;
}) {
  const segments = segmentMentions(comment.body, members);

  return (
    <div className="flex items-start gap-3">
      <Avatar
        name={comment.author.name}
        color={comment.author.avatarColor}
        size="sm"
        className="h-7 w-7 text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-ink">
            {comment.author.id === viewerId ? "You" : comment.author.name}
          </span>
          <span className="text-[11px] text-ink/35">
            {relativeFromNow(comment.createdAt)}
          </span>
        </p>

        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/75">
          {segments.map((segment, index) =>
            segment.kind === "mention" ? (
              <span
                key={index}
                className={cn(
                  "rounded px-1 font-medium",
                  segment.id === viewerId
                    ? "bg-warn-tint text-warn"
                    : "bg-brand-tint text-brand",
                )}
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}
