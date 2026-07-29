import Link from "next/link";
import { Activity, BarChart3, BookOpen, HelpCircle, Mail, ShieldCheck } from "lucide-react";
/*
 * Imported by module rather than through the `@/components/ui` barrel. This is
 * a Server Component, and the barrel pulls in every client primitive with it;
 * naming the two modules it actually uses keeps that boundary narrow.
 */
import { Card, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

/*
 * Both channel actions navigate (a mailto and internal routes), so both are
 * anchors rather than `Button`, which renders a `<button>`. These classes mirror
 * Button's `secondary` variant at size `sm` so the controls read as one set.
 * Every class name is a literal here — nothing is built from a fragment at
 * runtime, which is what Tailwind's scanner requires.
 */
const PILL_SECONDARY =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line-strong " +
  "bg-surface px-3.5 text-[0.8rem] font-medium whitespace-nowrap text-fg transition-colors duration-150 hover:bg-raised";

const BODY = "max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary";

/*
 * This page has now been corrected twice, and the second pass is the instructive one.
 *
 * The first pass cut three service-level claims — a "guaranteed 4-hour response time" for
 * enterprise, a 24-hour email SLA, and real-time chat "during business hours". Nothing in this
 * repo delivered any of them.
 *
 * But that pass replaced them with softer claims that were also unbacked, which is the failure
 * mode worth naming: removing a false promise is not the same as making a true one.
 *
 *   - "Enterprise plans cover the self-hosted runner, in-VPC semantic analysis, SSO, and
 *     custom detectors." There is no Enterprise tier. `packages/shared/src/plan-tier.ts`
 *     defines exactly three — free, team, scale — and none of the four things listed is one of
 *     its gated features. It named a plan that does not exist and described contents it does
 *     not have.
 *   - "Browse our guides, FAQs, and best practices." `/docs` renders its article list as plain
 *     text under the words "Not published yet." because none of it is written. The support page
 *     was promising what the docs page itself declines to promise.
 *   - "A person reads every message." No rota, no queue, no way to verify it — a latency claim
 *     with the number removed is still a claim.
 *
 * So this version points only at destinations that exist and can be checked by clicking them,
 * and states the absence of a support organisation outright instead of writing around it.
 * Constitution principle 1 ("no unmeasured claims") governs marketing copy as much as it
 * governs finding precision: a reader who tests a promise here and finds it hollow has learned
 * something true about how much to trust the benchmark.
 *
 * Do not reintroduce an SLA, a response time, or a named support tier without a system behind
 * it. When support tiers become real, gate them on `useOrg().org.planTier` (this is a Server
 * Component today, so that means splitting out a client child).
 */
export default function SupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        description="Gatepass has no support desk. This page lists what genuinely exists, and what to check before asking anyone."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          header={<CardTitle icon={<Activity size={15} aria-hidden="true" />}>Check this deployment first</CardTitle>}
        >
          <p className={BODY}>
            The System page probes which credentialed routes this deployment actually has configured — the GitHub
            webhook receiver, the self-hosted runner upload, and benchmark publishing. A capability that looks broken is
            most often one that was never configured, and that question answers itself here.
          </p>
          <Link href="/system" className={`${PILL_SECONDARY} mt-4`}>
            Open System
          </Link>
        </Card>

        <Card
          header={
            <CardTitle icon={<ShieldCheck size={15} aria-hidden="true" />}>Read the finding&apos;s evidence</CardTitle>
          }
        >
          <p className={BODY}>
            Every verified finding ships a runnable reproduction — the schema rejects one without it, so there is always
            something concrete to check. Research-tier findings carry a confidence score instead and are never presented
            with verified-tier certainty.
          </p>
          <Link href="/findings" className={`${PILL_SECONDARY} mt-4`}>
            Open Findings
          </Link>
        </Card>

        <Card header={<CardTitle icon={<BarChart3 size={15} aria-hidden="true" />}>The precision benchmark</CardTitle>}>
          <p className={BODY}>
            True- and false-positive rates measured against a versioned corpus, published rather than asserted. If a
            detector is wrong about your code, this is the number that should move — disputing a finding is a supported
            action, not a complaint.
          </p>
          <Link href="/benchmark" className={`${PILL_SECONDARY} mt-4`}>
            Open Benchmark
          </Link>
        </Card>

        <Card header={<CardTitle icon={<BookOpen size={15} aria-hidden="true" />}>Documentation</CardTitle>}>
          <p className={BODY}>
            The documentation index is live, but the articles in it are not written yet and the page says so plainly.
            Until they are published, the authoritative endpoint list is the route table at{" "}
            <span className="font-mono text-[0.8rem] text-fg">specs/001-gatepass-platform/contracts/api.md</span> in the
            repository.
          </p>
          <Link href="/docs" className={`${PILL_SECONDARY} mt-4`}>
            Open Docs
          </Link>
        </Card>
      </div>

      <Card header={<CardTitle icon={<Mail size={15} aria-hidden="true" />}>Email the people building it</CardTitle>}>
        <p className={BODY}>
          There is no support rota and no ticket queue behind this address — it reaches the people who write Gatepass,
          and nothing here promises when it is read. Include the scan ID, the finding fingerprint if there is one, and
          what you expected to happen instead; that is what makes a report reproducible.
        </p>
        <a href="mailto:founders@gatepass.dev" className={`${PILL_SECONDARY} mt-4`}>
          founders@gatepass.dev
        </a>
      </Card>

      {/* Neutral surface, not an amber one: the severity ramp is ordinal and
          reserved for finding severity, so a note about plans and support must not
          borrow a colour that means "medium severity" everywhere else in the product. */}
      <Card
        header={<CardTitle icon={<HelpCircle size={15} aria-hidden="true" />}>What this does not include</CardTitle>}
      >
        <p className={BODY}>
          No service-level agreement, no response-time commitment, no on-call rotation, and no support tier. Gatepass
          has not built the staffing to keep any of those, so it does not publish them.
        </p>
        <p className={`${BODY} mt-3`}>
          Plans are Free, Team and Scale. A plan decides which product features are enabled for an organization — the
          evidence export, questionnaire drafting and MCP fleet are gated this way — and it does not currently change
          anything about support. Should that change, the terms would be contractual rather than advertised here.
        </p>
      </Card>
    </div>
  );
}
