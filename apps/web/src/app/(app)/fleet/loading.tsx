import { Skeleton } from "@/components/ui/Skeleton";

export default function FleetLoading() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" className="h-8 w-32" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="card" className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="card" className="h-32" />
        ))}
      </div>
    </div>
  );
}
