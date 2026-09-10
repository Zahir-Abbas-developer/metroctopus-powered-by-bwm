"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Briefcase,
  CornerDownLeft,
  KanbanSquare,
  Layers,
  Search,
  Users2,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";

type Result = {
  kind: "lead" | "client" | "project" | "milestone" | "member";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const ICONS = {
  lead: Wallet,
  client: Briefcase,
  project: Layers,
  milestone: KanbanSquare,
  member: Users2,
};

const GROUP_LABEL: Record<Result["kind"], string> = {
  lead: "Pipeline",
  client: "Clients",
  project: "Projects",
  milestone: "Milestones",
  member: "Team",
};

/**
 * Cmd+K search.
 *
 * Results are scoped server-side by role, so a member's palette simply has
 * less in it rather than filtering out things it was sent.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setHighlight(0);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Debounced: typing "milestone" shouldn't fire nine queries.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!response.ok) return;
        const body = (await response.json()) as { results: Result[] };
        setResults(body.results);
        setHighlight(0);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  const grouped = useMemo(() => {
    const order: Result["kind"][] = ["lead", "client", "milestone", "project", "member"];
    return order
      .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
      .filter((group) => group.items.length > 0);
  }, [results]);

  const flat = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  const go = useCallback(
    (result: Result) => {
      setOpen(false);
      router.push(result.href);
    },
    [router],
  );

  if (!mounted) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] text-ink/45 transition-colors hover:border-ink/25 hover:text-ink/70 sm:flex"
      >
        <Search className="h-3.5 w-3.5" />
        Search
        <kbd className="ml-2 rounded border border-line bg-cream px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink/45">
          ⌘K
        </kbd>
      </button>

      {open &&
        createPortal(
          <div className="no-print fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
            <button
              type="button"
              aria-label="Close search"
              onClick={() => setOpen(false)}
              className="absolute inset-0 h-full w-full cursor-default bg-ink/40 animate-fade-in backdrop-blur-[2px]"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search"
              className="relative w-full max-w-lg animate-scale-in overflow-hidden rounded-card border border-line bg-white"
            >
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search className="h-4 w-4 shrink-0 text-ink/35" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlight((value) => (value + 1) % Math.max(flat.length, 1));
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlight(
                        (value) => (value - 1 + flat.length) % Math.max(flat.length, 1),
                      );
                    }
                    if (event.key === "Enter" && flat[highlight]) {
                      event.preventDefault();
                      go(flat[highlight]);
                    }
                  }}
                  placeholder="Search clients, projects, milestones, people…"
                  className="w-full bg-transparent py-4 text-sm text-ink placeholder:text-ink/35 focus:outline-none"
                />
              </div>

              <div className="scrollbar-thin max-h-[52vh] overflow-y-auto">
                {query.trim().length < 2 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink/40">
                    Type at least two characters.
                  </p>
                ) : loading && results.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink/40">
                    Searching…
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink/40">
                    Nothing matches &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  grouped.map((group) => (
                    <div key={group.kind}>
                      <p className="eyebrow px-4 pb-1 pt-3 text-ink/35">
                        {GROUP_LABEL[group.kind]}
                      </p>
                      <ul>
                        {group.items.map((result) => {
                          const Icon = ICONS[result.kind];
                          const index = flat.indexOf(result);

                          return (
                            <li key={`${result.kind}-${result.id}`}>
                              <button
                                type="button"
                                onMouseEnter={() => setHighlight(index)}
                                onClick={() => go(result)}
                                className={cn(
                                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                  index === highlight ? "bg-cream" : "hover:bg-cream/60",
                                )}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-white text-ink/50">
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-ink">
                                    {result.title}
                                  </span>
                                  <span className="block truncate text-[12px] text-ink/45">
                                    {result.subtitle}
                                  </span>
                                </span>
                                {index === highlight && (
                                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink/30" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-cream/60 px-4 py-2 text-[11px] text-ink/40">
                <span>↑↓ to move · ⏎ to open</span>
                <span>esc to close</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
