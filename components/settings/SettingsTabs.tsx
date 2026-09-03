"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Settings sections. The audit and error logs live here rather than as
 * top-level rail entries — they are administration, not daily work, and the
 * rail is deliberately the seven things a person uses.
 */
const SECTIONS = [
  { href: "/settings/departments", label: "Departments" },
  { href: "/settings/modules", label: "Modules" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/errors", label: "Error log" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-line">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {SECTIONS.map((section) => {
          const active =
            pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors",
                active
                  ? "border-brand font-medium text-ink"
                  : "border-transparent text-ink/55 hover:border-line hover:text-ink/80",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
