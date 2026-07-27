import { Skeleton } from "@/components/ui/Skeleton";

export default function AgentGuidanceLoading() {
  return (
    <div className="space-y-6">
      <Skeleton variant="text" className="h-8 w-56" />
      <Skeleton variant="card" className="h-48" />
    </div>
  );
}
