import Link from "next/link";
import { BookOpen, HelpCircle, Mail } from "lucide-react";
/*
 * Imported by module rather than through the `@/components/ui` barrel. This is
 * a Server Component, and the barrel pulls in every client primitive with it;
 * naming the two modules it actually uses keeps that boundary narrow.
 */
import { Card, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

/*
 * Both channel actions navigate (a mailto and an internal route), so both are
 * anchors rather than `Button`, which renders a `<button>`. These classes mirror
 * Button's `secondary` variant at size `sm` so the two controls read as one set.
 * Every class name is a literal here — nothing is built from a fragment at
 * runtime, which is what Tailwind's scanner requires.
 */
const PILL_SECONDARY =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-strong " +
  "bg-surface px-3.5 text-[0.8rem] font-medium whitespace-nowrap text-fg transition-colors duration-150 hover:bg-raised";

/*
 * RESOLVED — this page previously carried three unbacked service-level claims
 * (a "guaranteed 4-hour response time" for enterprise, a 24-hour email SLA, and
 * real-time chat "during business hours"). Nothing in this repo delivers any of
 * them, so all three were cut rather than honoured or softened.
 *
 * The rule that replaced them: this page describes only channels that exist and
 * makes no promise about how fast anyone answers. Constitution principle 1
 * ("no unmeasured claims") governs marketing copy as much as it governs finding
 * precision — a reader who checks a promise here and finds it hollow has learned
 * something true about how seriously to take the benchmark.
 *
 * Do not reintroduce an SLA on this page without a system behind it. When
 * support tiers become real, gate them on `useOrg().org.planTier` (this is a
 * Server Component today, so that means splitting out a client child).
 */
export default function SupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Support" description="Get help with Gatepass and the AI-native security stack." />

      {/* Two channels, both real. The third card was live chat, which does not
          exist; `sm:grid-cols-2` is now the widest track, so the support address
          keeps a column wide enough to sit on one line. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card header={<CardTitle icon={<Mail size={15} aria-hidden="true" />}>Email Us</CardTitle>}>
          <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
            Send us the scan ID and what you expected to happen. A person reads every message.
          </p>
          <a href="mailto:support@gatepass.dev" className={`${PILL_SECONDARY} mt-4`}>
            support@gatepass.dev
          </a>
        </Card>

        <Card header={<CardTitle icon={<BookOpen size={15} aria-hidden="true" />}>Knowledge Base</CardTitle>}>
          <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
            Browse our guides, FAQs, and best practices for the platform.
          </p>
          <Link href="/docs" className={`${PILL_SECONDARY} mt-4`}>
            Visit Docs
          </Link>
        </Card>
      </div>

      {/* Neutral surface, not an amber one: the severity ramp is ordinal and
          reserved for finding severity, so a support-tier note must not borrow
          a colour that means "medium severity" everywhere else in the product. */}
      <Card header={<CardTitle icon={<HelpCircle size={15} aria-hidden="true" />}>Enterprise plans</CardTitle>}>
        <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
          Enterprise plans cover the self-hosted runner, in-VPC semantic analysis, SSO, and detectors written against
          your own vulnerability classes. Support terms are agreed in the contract — we do not publish a response-time
          promise we have not built the staffing to keep.
        </p>
      </Card>
    </div>
  );
}
