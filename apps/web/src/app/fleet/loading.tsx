import { PageSkeleton } from "@/components/ui";

/** Five stat tiles + a short card grid — the shape the fleet route settles into. */
export default function FleetLoading() {
  return <PageSkeleton stats={5} rows={3} />;
}
