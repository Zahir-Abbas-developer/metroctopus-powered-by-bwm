import { Skeleton } from "@/components/ui/Skeleton";

export default function TeamLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-24 rounded-card border-0 bg-transparent" />

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[152px] rounded-card" />
        ))}
      </div>

      <Skeleton className="h-[360px] rounded-card" />
    </div>
  );
}
