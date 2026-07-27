import Link from "next/link";
import { BookOpen, HelpCircle, Mail, MessageSquare } from "lucide-react";
/*
 * Imported by module rather than through the `@/components/ui` barrel. This is
 * a Server Component, and the barrel pulls in every client primitive with it;
 * naming the two modules it actually uses keeps that boundary narrow.
 */
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

/*
 * `Button` renders a `<button>`, but two of the three channel actions navigate
 * (a mailto and an internal route), so those have to be anchors. The classes
 * mirror Button's `secondary` variant at size `sm` so all three controls read
 * as one set. Every class name is a literal here — nothing is built from a
 * fragment at runtime, which is what Tailwind's scanner requires.
 */
const PILL_SECONDARY =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-strong " +
  "bg-surface px-3.5 text-[0.8rem] font-medium whitespace-nowrap text-fg transition-colors duration-150 hover:bg-raised";

/*
 * ⚠ UNBACKED CLAIMS — see HANDOFF.md §5 "Unbacked product claims in the dashboard copy".
 *
 * Three sentences on this page promise service levels nothing in this repo
 * delivers: a "guaranteed 4-hour response time" for enterprise, a 24-hour email
 * SLA, and real-time chat "during business hours". They predate the redesign and
 * were left in place deliberately — they are product commitments, not code, so
 * cutting them is the founder's call, not a refactor.
 *
 * Do not treat their presence as evidence they are true. If you are here to edit
 * this copy, resolve them: honour, soften, or cut. The enterprise line in
 * particular renders identically for a free-tier org — `useOrg().org.planTier`
 * is available and is not consulted.
 */
export default function SupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Support" description="Get help with Gatepass and the AI-native security stack." />

      {/* Two columns before three: at the `sm` breakpoint a third column leaves
          the support address too narrow to sit on one line. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card header={<CardTitle icon={<MessageSquare size={15} aria-hidden="true" />}>Live Chat</CardTitle>}>
          <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
            Chat with our support team in real-time during business hours.
          </p>
          {/*
            No chat integration is wired up, so the control is disabled and says
            why. It previously rendered as a live primary button with no onClick
            — a button that looks clickable and does nothing is worse than one
            that admits it is not ready.
          */}
          <Button variant="primary" size="sm" className="mt-4" disabled title="Live chat is not connected yet">
            Start Chat
          </Button>
          <p className="mt-2 text-[0.72rem] text-fg-faint">Not connected yet — use email below.</p>
        </Card>

        <Card header={<CardTitle icon={<Mail size={15} aria-hidden="true" />}>Email Us</CardTitle>}>
          <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
            Send a detailed ticket and we&apos;ll respond within 24 hours.
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
      <Card header={<CardTitle icon={<HelpCircle size={15} aria-hidden="true" />}>Enterprise Support</CardTitle>}>
        <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
          Enterprise tier customers get priority support with a dedicated engineer and guaranteed 4-hour response time.
        </p>
      </Card>
    </div>
  );
}
