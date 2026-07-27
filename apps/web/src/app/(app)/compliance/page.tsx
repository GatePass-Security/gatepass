import { ComplianceDashboard } from "./ComplianceDashboard";

export const metadata = {
  title: "Compliance — Gatepass",
  description: "Compliance posture dashboard — WCAG 2.2, CCPA/CPRA, Apple App Store, Google Play, EU AI Act",
};

export default function Page() {
  return <ComplianceDashboard />;
}
