"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { TeamMember } from "@/lib/types";

/**
 * Confirmation for deactivating or restoring a member. Deactivation is used
 * instead of deletion so past work, scores and reports stay attributable.
 */
export function MemberStatusModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const deactivating = member?.isActive ?? true;

  useEffect(() => {
    if (member) setError(null);
  }, [member]);

  async function confirm() {
    if (!member) return;
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !member.isActive }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onSaved(
        deactivating
          ? `${member.name} has been deactivated.`
          : `${member.name} is active again.`,
      );
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      busy={saving}
      size="sm"
      eyebrow={deactivating ? "Deactivate" : "Reactivate"}
      title={deactivating ? `Deactivate ${member?.name}?` : `Reactivate ${member?.name}?`}
      description={
        deactivating
          ? "They'll lose access to the workspace immediately. Their completed work, scores and reports are kept."
          : "They'll be able to sign in again and receive new task assignments."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={deactivating ? "danger" : "primary"}
            onClick={confirm}
            loading={saving}
          >
            {deactivating ? "Deactivate" : "Reactivate"}
          </Button>
        </>
      }
    >
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-ink/60">
          {deactivating
            ? "You can restore access at any time from this page."
            : "Assignments made while they were away are unaffected."}
        </p>
      )}
    </Modal>
  );
}
