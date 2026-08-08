"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { JOB_TITLES, ROLES, ROLE_LABEL } from "@/lib/constants";
import {
  MIN_PASSWORD_LENGTH,
  createUserSchema,
  fieldErrors,
  updateUserSchema,
} from "@/lib/validation";
import type { TeamMember } from "@/lib/types";

type Draft = {
  name: string;
  email: string;
  jobTitle: string;
  role: string;
  password: string;
};

const EMPTY: Draft = {
  name: "",
  email: "",
  jobTitle: "",
  role: "MEMBER",
  password: "",
};

const ROLE_OPTIONS = ROLES.map((value) => ({
  value,
  label: `${ROLE_LABEL[value]} (${value})`,
}));

export function TeamMemberModal({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present in edit mode, absent when adding. */
  member: TeamMember | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(member);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset whenever the dialog opens so a previous edit never leaks in.
  useEffect(() => {
    if (!open) return;
    setDraft(
      member
        ? {
            name: member.name,
            email: member.email,
            jobTitle: member.jobTitle,
            role: member.role,
            password: "",
          }
        : EMPTY,
    );
    setErrors({});
    setFormError(null);
  }, [open, member]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Validate with the same schema the API uses.
    const payload = editing
      ? { ...draft, password: draft.password || undefined }
      : draft;
    const parsed = editing
      ? updateUserSchema.safeParse(payload)
      : createUserSchema.safeParse(payload);

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/team/${member!.id}` : "/api/team",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onSaved(
        editing
          ? `${parsed.data.name ?? member!.name} has been updated.`
          : `${draft.name} has been added to the team.`,
      );
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      eyebrow={editing ? "Edit member" : "New member"}
      title={editing ? member!.name : "Add a team member"}
      description={
        editing
          ? "Update their details, role or password."
          : "They'll be able to sign in immediately with the password you set."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="team-member-form" loading={saving}>
            {editing ? "Save changes" : "Add member"}
          </Button>
        </>
      }
    >
      <form id="team-member-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <Input
          label="Full name"
          requiredMark
          placeholder="Saad Tariq"
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          error={errors.name}
          disabled={saving}
        />

        <Input
          label="Email"
          type="email"
          requiredMark
          autoComplete="off"
          placeholder="saad@agency.local"
          value={draft.email}
          onChange={(event) => set("email", event.target.value)}
          error={errors.email}
          disabled={saving}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input
              label="Job title"
              requiredMark
              list="job-title-suggestions"
              placeholder="Performance Marketer"
              value={draft.jobTitle}
              onChange={(event) => set("jobTitle", event.target.value)}
              error={errors.jobTitle}
              disabled={saving}
            />
            <datalist id="job-title-suggestions">
              {JOB_TITLES.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
          </div>

          <Select
            label="Role"
            requiredMark
            options={ROLE_OPTIONS}
            value={draft.role}
            onChange={(event) => set("role", event.target.value)}
            error={errors.role}
            disabled={saving}
            hint={draft.role === "ADMIN" ? "Full access to everything" : undefined}
          />
        </div>

        <Input
          label={editing ? "New password" : "Password"}
          type="password"
          requiredMark={!editing}
          autoComplete="new-password"
          placeholder={editing ? "Leave blank to keep current" : "At least 8 characters"}
          value={draft.password}
          onChange={(event) => set("password", event.target.value)}
          error={errors.password}
          disabled={saving}
          hint={
            editing
              ? "Only fill this in if you want to reset their password."
              : `Minimum ${MIN_PASSWORD_LENGTH} characters. Share it with them privately.`
          }
        />
      </form>
    </Modal>
  );
}
