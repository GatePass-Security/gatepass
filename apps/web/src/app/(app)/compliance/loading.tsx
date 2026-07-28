import { ComplianceSkeleton } from "./ComplianceSkeleton";

/**
 * The compliance scan runs server-side on every request, so this placeholder is
 * on screen for a real interval rather than a flash — which is why it mirrors
 * the page's own geometry instead of using the generic `PageSkeleton`.
 */
export default function ComplianceLoading() {
  return <ComplianceSkeleton />;
}
