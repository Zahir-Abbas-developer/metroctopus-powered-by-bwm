import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-white">
        <EmptyState
          icon={Compass}
          eyebrow="404"
          title="This page doesn't exist"
          description="The link may be out of date, or the page may have moved as the platform grows."
          action={
            <Link href="/dashboard" className={buttonClasses("primary", "md")}>
              Back to dashboard
            </Link>
          }
        />
      </div>
    </main>
  );
}
