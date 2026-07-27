import { FileText, Code, Shield, Server, Search, BookOpen, ExternalLink } from "lucide-react";

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

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gatepass-900">Documentation</h1>
        <p className="mt-1 text-sm text-gatepass-500">
          Guides, API references, and best practices for the Gatepass platform.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_SECTIONS.map((section) => (
          <div key={section.title} className="rounded-lg border border-gatepass-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0891b2]/10">
                <section.icon size={20} className="text-[#0891b2]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gatepass-900">{section.title}</h2>
                <p className="text-sm text-gatepass-500">{section.description}</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {section.articles.map((article) => (
                <li key={article}>
                  <a
                    href="#"
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gatepass-700 hover:bg-gatepass-50 transition-colors"
                  >
                    <FileText size={14} className="shrink-0 text-gatepass-400" />
                    {article}
                    <ExternalLink size={12} className="ml-auto shrink-0 text-gatepass-300" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gatepass-200 bg-white p-6">
        <div className="flex items-start gap-3">
          <BookOpen size={20} className="mt-0.5 shrink-0 text-[#0891b2]" />
          <div>
            <p className="text-sm font-medium text-gatepass-900">Need more help?</p>
            <p className="mt-1 text-sm text-gatepass-500">
              Check the support page for live chat and ticket options, or browse our API reference for programmatic
              access.
            </p>
            <div className="mt-3 flex gap-3">
              <a
                href="/support"
                className="rounded-md bg-[#0891b2] px-4 py-2 text-sm font-medium text-white hover:bg-[#0e7490] transition-colors"
              >
                Contact Support
              </a>
              <a
                href="#"
                className="rounded-md border border-gatepass-300 px-4 py-2 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
              >
                API Reference
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
