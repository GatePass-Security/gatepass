import Link from "next/link";
import { BookOpen, Code, FileText, Search, Server, Shield } from "lucide-react";
/*
 * Imported by module rather than through the `@/components/ui` barrel. This is
 * a Server Component, and the barrel pulls in every client primitive with it;
 * naming the two modules it actually uses keeps that boundary narrow.
 */
import { Card, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

const DOC_SECTIONS = [
  {
    icon: Search,
    title: "Getting Started",
    description: "Learn how to set up Gatepass for your organization and run your first scan.",
    articles: ["Quickstart Guide", "Installation & Setup", "First Scan Walkthrough", "Understanding Findings"],
  },
  {
    icon: Shield,
    title: "Security Analysis",
    description: "Deep dive into verified and research-tier findings, and how to remediate them.",
    articles: ["Finding Tiers Explained", "Reproduction Steps", "Dispute Workflow", "Agent Guidance"],
  },
  {
    icon: Server,
    title: "Fleet Management",
    description: "Monitor and manage your MCP servers and agentic infrastructure.",
    articles: ["Registering Servers", "Posture Monitoring", "Posture Remediation", "Fleet API Reference"],
  },
  {
    icon: Code,
    title: "Integrations",
    description: "Connect Gatepass with your existing toolchain and compliance platforms.",
    articles: ["GitHub App Setup", "CI/CD Pipeline Integration", "Vanta & Drata Integration", "API & Webhooks"],
  },
];

/*
 * `Button` renders a `<button>`, but these actions navigate, so they have to be
 * anchors. The classes mirror Button's `primary` / `secondary` variants at size
 * `md` so the control is indistinguishable from a real one on screen. Every
 * class name appears as a literal in this file, which is what Tailwind's
 * scanner needs — nothing is assembled from a fragment at runtime.
 */
const PILL_BASE =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-4 " +
  "text-[0.855rem] font-medium whitespace-nowrap transition-[background-color,color,border-color] duration-150";
const PILL_PRIMARY = `${PILL_BASE} bg-action text-action-text hover:bg-action-hover`;

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentation"
        description="Guides, API references, and best practices for the Gatepass platform."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_SECTIONS.map((section) => (
          <Card
            key={section.title}
            header={<CardTitle icon={<section.icon size={15} aria-hidden="true" />}>{section.title}</CardTitle>}
          >
            <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">{section.description}</p>

            {/*
              These articles are not written yet. Rendering them as anchors to
              "#" made every row look like navigation and quietly asserted the
              page existed — a titled, hoverable, focusable row in a docs index
              is a promise. Until there is somewhere to go they are plain text,
              and the section says so once rather than 16 times.
            */}
            <ul className="mt-4 space-y-1.5">
              {section.articles.map((article) => (
                <li key={article} className="flex items-center gap-2.5 text-[0.82rem] text-fg-muted">
                  <FileText size={14} className="shrink-0 text-fg-faint" aria-hidden="true" />
                  <span className="truncate">{article}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.72rem] text-fg-faint">Not published yet.</p>
          </Card>
        ))}
      </div>

      <Card header={<CardTitle icon={<BookOpen size={15} aria-hidden="true" />}>Need more help?</CardTitle>}>
        <p className="max-w-prose text-[0.855rem] leading-relaxed text-fg-secondary">
          Contact support for help with the platform. The API reference is not published yet — until it is, the route
          table in <span className="font-mono text-[0.8rem] text-fg">specs/001-gatepass-platform/contracts/api.md</span>{" "}
          is the authoritative list of endpoints.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/support" className={PILL_PRIMARY}>
            Contact Support
          </Link>
        </div>
      </Card>
    </div>
  );
}
