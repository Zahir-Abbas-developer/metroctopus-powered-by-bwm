"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

import { Input, type InputProps } from "@/components/ui/Input";

/**
 * A password field that can show what was typed.
 *
 * Built after a team member could not sign in with a password that was, when
 * checked against the database, exactly right — the usual culprits being a
 * trailing space picked up when copying it out of a chat, or a capital letter
 * a phone keyboard swallowed. A masked field hides both. Showing the text is
 * the one thing that lets a person see the mistake for themselves.
 *
 * Phone keyboards are also told to leave the value alone: no automatic capital
 * on the first letter, no autocorrect, no spellcheck. None of those belong
 * anywhere near a password, and iOS applies some of them to any field it
 * cannot classify.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(
  function PasswordInput({ icon, disabled, ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <Input
        ref={ref}
        {...props}
        type={visible ? "text" : "password"}
        icon={icon ?? <Lock className="h-4 w-4" />}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/40 transition-colors hover:bg-cream hover:text-ink disabled:opacity-40"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />
    );
  },
);
