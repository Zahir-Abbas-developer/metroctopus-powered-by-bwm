import { Skeleton } from "@/components/ui/Skeleton";

export default function ClientsLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-24 rounded-card border-0 bg-transparent" />
      <Skeleton className="h-10 w-96 rounded-pill" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[248px] rounded-card" />
        ))}
      </div>
    </div>
  );
}
