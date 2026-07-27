import { Skeleton } from "@/components/ui/Skeleton";

export default function BenchmarkLoading() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" className="h-8 w-64" />
      <Skeleton variant="card" className="h-64" />
    </div>
  );
}
