import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-[248px] rounded-card" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[152px] rounded-card" />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[320px] rounded-card" />
        <Skeleton className="h-[320px] rounded-card" />
      </div>
    </div>
  );
}
