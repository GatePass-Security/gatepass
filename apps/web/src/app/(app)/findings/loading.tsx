import { Skeleton } from "@/components/ui/Skeleton";

export default function FindingsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton variant="text" className="h-8 w-48" />
      <Skeleton variant="text" className="h-5 w-72" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-40" />
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} variant="card" className="h-32" />
      ))}
    </div>
  );
}
