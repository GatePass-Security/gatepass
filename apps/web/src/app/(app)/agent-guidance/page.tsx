"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";

import { EmptyState } from "@/components/ui/EmptyState";
import { Loader2, AlertTriangle, Lightbulb, Lock, Sparkles, CheckCircle2, Copy } from "lucide-react";

export default function AgentGuidancePage() {
  const [scanId, setScanId] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<{ content: string; kind: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scanId || !fingerprint) return;
    setLoading(true);
    setError(null);
    setGuidance(null);
    try {
      const result = await api.getAgentGuidance(ORG_ID, scanId, fingerprint);
      setGuidance(result.guidance);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Forbidden")) {
        setError("Agent-loop guidance is not enabled for this repository.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch guidance");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gatepass-900 dark:text-white">Agent Guidance</h1>
        <p className="mt-1 text-sm text-gatepass-500">Generate automated remediation steps for security findings.</p>
      </div>

      {/* Card 1 — Request Remediation */}
      <div className="rounded-lg border border-gatepass-200 bg-white p-6 dark:bg-gatepass-800/50 dark:border-gatepass-700">
        <h2 className="text-lg font-semibold text-gatepass-900 dark:text-white">Request Remediation</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="scan-id" className="block text-sm font-medium text-gatepass-700 dark:text-gatepass-300">
                Scan ID
              </label>
              <input
                id="scan-id"
                type="text"
                value={scanId}
                onChange={(e) => setScanId(e.target.value)}
                placeholder="Enter scan ID..."
                className="mt-1 block w-full rounded-md border border-gatepass-300 bg-white px-4 py-2.5 text-sm text-gatepass-900 placeholder-gatepass-400 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2] dark:border-gatepass-600 dark:bg-gatepass-900 dark:text-white dark:placeholder-gatepass-500"
                required
              />
            </div>
            <div>
              <label
                htmlFor="finding-fingerprint"
                className="block text-sm font-medium text-gatepass-700 dark:text-gatepass-300"
              >
                Finding Fingerprint
              </label>
              <input
                id="finding-fingerprint"
                type="text"
                value={fingerprint}
                onChange={(e) => setFingerprint(e.target.value)}
                placeholder="sha256:..."
                className="mt-1 block w-full rounded-md border border-gatepass-300 bg-white px-4 py-2.5 text-sm text-gatepass-900 placeholder-gatepass-400 focus:border-[#0891b2] focus:outline-none focus:ring-1 focus:ring-[#0891b2] dark:border-gatepass-600 dark:bg-gatepass-900 dark:text-white dark:placeholder-gatepass-500"
                required
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading || !scanId || !fingerprint}
              className="inline-flex items-center gap-2 rounded-md bg-[#0891b2] px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Get Guidance
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Error / 403 state */}
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950">
          <div className="flex items-start gap-3">
            {error.includes("not enabled") ? (
              <Lock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {error.includes("not enabled") ? "Feature Not Available" : "Error"}
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Card 2 — Generated Guidance */}
      {guidance && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-6 dark:bg-gatepass-800/50 dark:border-gatepass-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-gatepass-900 dark:text-white">Generated Guidance</h2>
          </div>
          <p className="mt-1 text-sm text-gatepass-500">Automated remediation steps for the selected finding.</p>

          {/* Code block */}
          <div className="mt-4 rounded-lg bg-gatepass-800 dark:bg-gatepass-950 overflow-hidden">
            <div className="flex items-center justify-between border-b border-gatepass-700 px-4 py-2">
              <span className="text-sm text-gatepass-300">{guidance.kind}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(guidance.content)}
                className="rounded p-1 text-gatepass-400 hover:text-white hover:bg-gatepass-700 transition-colors"
                title="Copy to clipboard"
              >
                <Copy size={14} />
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              <pre className="whitespace-pre-wrap text-sm font-mono text-gatepass-200 leading-relaxed">
                {guidance.content.split("\n").map((line, i) => {
                  if (line.startsWith("+") || line.startsWith("add ")) {
                    return (
                      <div key={i} className="bg-emerald-500/10 -mx-4 px-4">
                        <span className="text-emerald-400">{line}</span>
                      </div>
                    );
                  }
                  if (line.startsWith("-") || line.startsWith("remove ")) {
                    return (
                      <div key={i} className="bg-red-500/10 -mx-4 px-4">
                        <span className="text-red-400">{line}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={i}>
                      <span>{line}</span>
                    </div>
                  );
                })}
              </pre>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setGuidance(null)}
              className="rounded-md border border-gatepass-300 px-4 py-2.5 text-sm font-medium text-gatepass-700 hover:bg-gatepass-50 dark:border-gatepass-600 dark:text-gatepass-300 dark:hover:bg-gatepass-700 transition-colors"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(guidance.content)}
              className="inline-flex items-center gap-2 rounded-md bg-[#0891b2] px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            >
              Apply Patch
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!guidance && !error && !loading && (
        <EmptyState
          icon={<Lightbulb size={48} />}
          title="Enter finding details"
          description="Provide a scan ID and finding fingerprint to retrieve guidance"
        />
      )}
    </div>
  );
}
