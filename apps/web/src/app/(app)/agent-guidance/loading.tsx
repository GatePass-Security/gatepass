import { PageSkeleton } from "@/components/ui/Skeleton";

/** No stat row on this page — a selector card above a result surface. */
export default function AgentGuidanceLoading() {
  return <PageSkeleton stats={0} rows={5} />;
}
