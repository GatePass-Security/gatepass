import { PageSkeleton } from "@/components/ui/Skeleton";

/** Stats row stands in for the five per-standard score cards; rows for the check list. */
export default function ComplianceLoading() {
  return <PageSkeleton stats={4} rows={6} />;
}
