"use client";

import { useMemo, useRef, useState } from "react";
import { AtSign, Send } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export type MentionMember = {
  id: string;
  name: string;
  avatarColor: string;
  jobTitle?: string;
};

/**
 * Comment box with @mention autocomplete.
 *
 * The picker inserts the member's full name, which is what the server-side
 * parser resolves against — so what you pick is exactly what gets notified,
 * with no separate handle to keep in sync.
 */
export function CommentComposer({
  members,
  placeholder = "Add a comment… use @ to mention someone",
  submitting,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  members: MentionMember[];
  placeholder?: string;
  submitting: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return members
      .filter((member) => member.name.toLowerCase().includes(needle))
      .slice(0, 5);
  }, [query, members]);

  /** Tracks the token being typed after the most recent "@". */
  function syncQuery(value: string, caret: number) {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");

    if (at === -1) {
      setQuery(null);
      return;
    }

    // Only a mention if the "@" starts a word.
    if (at > 0 && /[\w.]/.test(before[at - 1])) {
      setQuery(null);
      return;
    }

    const token = before.slice(at + 1);
    // A name is at most two words; anything longer is prose, not a mention.
    if (token.includes("\n") || token.split(/\s+/).length > 2) {
      setQuery(null);
      return;
    }

    setQuery(token);
    setHighlight(0);
  }

  function insert(member: MentionMember) {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return;

    const next = `${body.slice(0, at)}@${member.name} ${body.slice(caret)}`;
    setBody(next);
    setQuery(null);

    requestAnimationFrame(() => {
      const position = at + member.name.length + 2;
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  }

  function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    onSubmit(trimmed);
    setBody("");
    setQuery(null);
  }

  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        rows={3}
        autoFocus={autoFocus}
        value={body}
        disabled={submitting}
        placeholder={placeholder}
        onChange={(event) => {
          setBody(event.target.value);
          syncQuery(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (matches.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((value) => (value + 1) % matches.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((value) => (value - 1 + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              insert(matches[highlight]);
              return;
            }
            if (event.key === "Escape") {
              setQuery(null);
              return;
            }
          }

          // Cmd/Ctrl+Enter posts, so a plain Enter can still be a new line.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className={cn(
          "w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink transition-colors",
          "placeholder:text-ink/35 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25",
          "disabled:cursor-not-allowed disabled:bg-cream disabled:text-ink/40",
        )}
      />

      {matches.length > 0 && (
        <ul className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-card border border-line bg-white">
          {matches.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                onMouseDown={(event) => {
                  // mousedown, not click: the textarea must not lose focus first.
                  event.preventDefault();
                  insert(member);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  index === highlight ? "bg-brand-tint" : "hover:bg-cream",
                )}
              >
                <Avatar name={member.name} color={member.avatarColor} size="sm" className="h-6 w-6 text-[9px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {member.name}
                  </span>
                  {member.jobTitle && (
                    <span className="block truncate text-[11px] text-ink/45">
                      {member.jobTitle}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-ink/35">
          <AtSign className="h-3 w-3" />
          Mention someone to notify them
        </p>

        <div className="flex items-center gap-2">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={submit}
            loading={submitting}
            disabled={body.trim().length === 0}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
