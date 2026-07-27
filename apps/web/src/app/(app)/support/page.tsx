import { HelpCircle, Mail, MessageSquare, BookOpen } from "lucide-react";

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gatepass-900">Support</h1>
        <p className="mt-1 text-sm text-gatepass-500">Get help with Gatepass and the AI-native security stack.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gatepass-200 bg-white p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">
            <MessageSquare size={20} className="text-[#0891b2]" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gatepass-900">Live Chat</h2>
          <p className="mt-1 text-sm text-gatepass-500">
            Chat with our support team in real-time during business hours.
          </p>
          <button className="mt-4 rounded-md bg-[#0891b2] px-4 py-2 text-sm font-medium text-white hover:bg-[#0e7490] transition-colors">
            Start Chat
          </button>
        </div>

        <div className="rounded-lg border border-gatepass-200 bg-white p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">
            <Mail size={20} className="text-[#0891b2]" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gatepass-900">Email Us</h2>
          <p className="mt-1 text-sm text-gatepass-500">
            Send a detailed ticket and we&apos;ll respond within 24 hours.
          </p>
          <a
            href="mailto:support@gatepass.dev"
            className="mt-4 inline-block rounded-md border border-gatepass-300 px-4 py-2 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
          >
            support@gatepass.dev
          </a>
        </div>

        <div className="rounded-lg border border-gatepass-200 bg-white p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">
            <BookOpen size={20} className="text-[#0891b2]" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gatepass-900">Knowledge Base</h2>
          <p className="mt-1 text-sm text-gatepass-500">
            Browse our guides, FAQs, and best practices for the platform.
          </p>
          <a
            href="/docs"
            className="mt-4 inline-block rounded-md border border-gatepass-300 px-4 py-2 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 transition-colors"
          >
            Visit Docs
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <HelpCircle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">Enterprise Support</p>
            <p className="mt-1 text-sm text-amber-700">
              Enterprise tier customers get priority support with a dedicated engineer and guaranteed 4-hour response
              time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
