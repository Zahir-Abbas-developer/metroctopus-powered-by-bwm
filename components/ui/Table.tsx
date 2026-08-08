import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Composable table primitives. `TableShell` supplies the 1px frame and the
 * horizontal scroll container that keeps wide tables usable on mobile without
 * the page itself scrolling sideways.
 */

export function TableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-line bg-white", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("w-full min-w-[640px] border-collapse text-sm", className)}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-cream">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  className,
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  /** Dims the row — used for deactivated records. */
  muted?: boolean;
  }) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-cream/50",
        muted && "bg-paper/60 text-ink/50",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <th
      scope="col"
      className={cn(
        "eyebrow border-b border-line px-4 py-3 text-left text-ink/50 sm:px-5",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <td className={cn("px-4 py-3.5 align-middle sm:px-5", className)} {...props}>
      {children}
    </td>
  );
}
