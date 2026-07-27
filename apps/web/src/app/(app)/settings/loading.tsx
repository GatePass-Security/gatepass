import { PageSkeleton } from "@/components/ui/Skeleton";

/** Settings has no stat row — two stacked cards, so the placeholder is rows only. */
export default function SettingsLoading() {
  return <PageSkeleton stats={0} rows={4} />;
}
