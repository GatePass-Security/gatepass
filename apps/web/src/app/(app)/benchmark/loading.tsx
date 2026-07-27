// Imported from the module rather than the `ui` barrel: this is a Server
// Component, and the barrel re-exports client-only primitives (Table).
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Three headline stats and one row per benchmarked class — matches the real layout. */
export default function BenchmarkLoading() {
  return <PageSkeleton stats={3} rows={6} />;
}
