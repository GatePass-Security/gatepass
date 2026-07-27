// Imported from the module, not the `ui` barrel: this is a server component and
// the barrel re-exports client-only primitives.
import { PageSkeleton } from "@/components/ui/Skeleton";

/** Four stat tiles and a run of finding cards — the geometry the route resolves to. */
export default function FindingsLoading() {
  return <PageSkeleton stats={4} rows={6} />;
}
