"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { AssigneePicker } from "@/components/fields/AssigneePicker";
import type { CreatableDepartment } from "@/lib/departments";
import type { AssignableMember } from "@/lib/assignment";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  type TaskPriority,
} from "@/lib/constants";

/**
 * Adding a task.
 *
 * Department first, for the same reason a lead is: it decides who may be given
 * the work. The assignee list is that department's members and nobody else,
 * reusing the picker the creation wizard already uses rather than a second
 * control that would drift from it.
 */
export function TaskFormModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [departments, setDepartments] = useState<CreatableDepartment[] | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [assignees, setAssignees] = useState<AssignableMember[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeId, setAssigneeId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setNote("");
    setDueAt("");
    setPriority("MEDIUM");
    setAssigneeId("");
    setErrors({});

    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/departments/creatable");
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      const rows: CreatableDepartment[] = body?.departments ?? [];
      setDepartments(rows);
      // One department is not a choice worth making — pick it.
      if (rows.length > 0) {
        setDepartmentId(rows[0].id);
        void loadAssignees(rows[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function loadAssignees(id: string) {
    const response = await fetch(`/api/departments/${id}/form?entity=LEAD`);
    const body = await response.json().catch(() => ({}));
    setAssignees(body?.assignees ?? []);
  }

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId,
          title,
          note,
          dueAt: dueAt || null,
          priority,
          ...(assigneeId ? { assigneeId } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save that task.");
        return;
      }

      toast.success("Task added.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a task">
      <div className="space-y-4">
        {(departments?.length ?? 0) > 1 && (
          <Select
            label="Department"
            value={departmentId}
            error={errors.departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setAssigneeId("");
              void loadAssignees(event.target.value);
            }}
            options={(departments ?? []).map((row) => ({
              value: row.id,
              label: row.shortLabel,
            }))}
          />
        )}

        <Input
          label="Task"
          requiredMark
          autoFocus
          value={title}
          error={errors.title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Call back about the revised quote"
        />

        <Textarea
          label="Note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Due"
            type="date"
            value={dueAt}
            error={errors.dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            hint="Leave empty if it has no date"
          />
          <Select
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            options={TASK_PRIORITIES.map((value) => ({
              value,
              label: TASK_PRIORITY_LABEL[value],
            }))}
          />
        </div>

        {assignees.length > 0 && (
          <AssigneePicker
            members={assignees}
            value={assigneeId}
            onChange={setAssigneeId}
            label="Assign to"
          />
        )}
        {errors.assigneeId && (
          <p className="text-[12px] text-danger">{errors.assigneeId}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={title.trim().length < 2 || !departmentId}
            onClick={() => void save()}
          >
            Add task
          </Button>
        </div>
      </div>
    </Modal>
  );
}
