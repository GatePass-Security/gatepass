import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-8">
      <Skeleton variant="text" className="h-8 w-32" />
      <Skeleton variant="card" className="h-32" />
      <Skeleton variant="card" className="h-48" />
    </div>
  );
}
