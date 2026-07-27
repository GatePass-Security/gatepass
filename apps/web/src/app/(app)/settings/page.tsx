"use client";

import { useState, useEffect } from "react";
import { useOrg } from "@/providers/OrgProvider";
import { api } from "@/lib/api-client";
import { ORG_ID } from "@/lib/constants";

import { AlertTriangle, Building2, CheckCircle2, FolderGit2, Loader2, Pencil, X } from "lucide-react";
import type { RepoRecord } from "@/lib/types";

export default function SettingsPage() {
  const { org, loading: orgLoading, error: orgError } = useOrg();
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (org) setLlmEnabled(org.llmEnabled);
    api
      .getRepos(ORG_ID)
      .then(setRepos)
      .catch(() => {});
  }, [org]);

  async function toggleLlm() {
    const next = !llmEnabled;
    setLlmEnabled(next);
    setSaving("org");
    try {
      await api.patchOrgSettings(ORG_ID, { llm_analysis_enabled: next });
      setMessage({ type: "success", text: "Settings saved" });
    } catch {
      setLlmEnabled(!next);
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(null);
    }
  }

  async function toggleAgentLoop(repoName: string, enabled: boolean) {
    setSaving(repoName);
    try {
      await api.patchRepoSettings(ORG_ID, repoName, { agent_loop_enabled: enabled });
      setRepos(repos.map((r) => (r.name === repoName ? ({ ...r, agentLoopEnabled: enabled } as never) : r)));
      setMessage({ type: "success", text: "Repo settings saved" });
    } catch {
      setMessage({ type: "error", text: "Failed to save repo settings" });
    } finally {
      setSaving(null);
    }
  }

  if (orgLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gatepass-400" />
      </div>
    );
  }

  if (orgError && !org) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">Could not load settings: {orgError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gatepass-900 dark:text-white">Settings</h1>
          <p className="mt-1 text-sm text-gatepass-500">
            Manage your organization preferences and repository configurations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="rounded-md border border-gatepass-300 px-4 py-2 text-sm text-gatepass-700 hover:bg-gatepass-50 transition-colors">
            Cancel
          </button>
          <button className="rounded-md bg-[#0891b2] px-4 py-2 text-sm font-medium text-white hover:bg-[#0e7490] transition-colors">
            Save Changes
          </button>
        </div>
      </div>

      {/* Success banner */}
      {message && message.type === "success" && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 size={20} className="mt-0.5 text-emerald-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800">Configuration Saved</p>
            <p className="text-sm text-emerald-700">{message.text}</p>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Error banner */}
      {message && message.type === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message.text}</div>
      )}

      {/* Organization card */}
      <div className="rounded-lg border border-gatepass-200 bg-white p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">
            <Building2 size={20} className="text-[#0891b2]" />
          </div>
          <h2 className="text-lg font-semibold text-gatepass-900">Organization</h2>
        </div>

        <div className="space-y-5">
          {/* Plan tier */}
          <div className="flex items-center justify-between">
            <div>
              <label className="mb-1 block text-sm font-medium text-gatepass-700">Plan Tier</label>
              <p className="text-sm text-gatepass-500">{org?.planTier ?? "N/A"}</p>
            </div>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">Active</span>
          </div>

          {/* LLM toggle */}
          <div className="flex items-center justify-between border-t border-gatepass-100 pt-5">
            <div>
              <p className="text-sm font-medium text-gatepass-900">LLM Analysis</p>
              <p className="text-xs text-gatepass-500">Enable research-tier semantic analysis</p>
            </div>
            <button
              onClick={toggleLlm}
              disabled={saving === "org"}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${llmEnabled ? "bg-[#0891b2]" : "bg-gatepass-300 dark:bg-gatepass-600"}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${llmEnabled ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Repository configurations card */}
      {repos.length > 0 && (
        <div className="rounded-lg border border-gatepass-200 bg-white p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0891b2]/10">
              <FolderGit2 size={20} className="text-[#0891b2]" />
            </div>
            <h2 className="text-lg font-semibold text-gatepass-900">Repository Configurations</h2>
          </div>

          <div className="space-y-4">
            {repos.map((repo) => (
              <div key={repo.name} className="rounded-lg border border-gatepass-200 bg-gatepass-50 p-4">
                {/* Repo header */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <p className="font-medium text-gatepass-900">{repo.name}</p>
                    <span className="rounded bg-gatepass-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gatepass-600">
                      Private
                    </span>
                  </div>
                  <button className="flex items-center gap-1 text-sm text-[#0891b2] hover:text-[#0e7490] transition-colors">
                    <Pencil size={13} />
                    Edit Rules
                  </button>
                </div>

                {/* Frameworks */}
                {(repo.frameworks ?? []).length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-xs font-medium text-gatepass-500">Detected Frameworks</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(repo.frameworks ?? []).map((fw) => (
                        <span
                          key={fw}
                          className="inline-flex items-center rounded-md border border-gatepass-200 bg-white px-2.5 py-1 text-xs text-gatepass-700"
                        >
                          {fw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agent Loop toggle */}
                <div className="flex items-center justify-between border-t border-gatepass-200 pt-3">
                  <div>
                    <p className="text-sm font-medium text-gatepass-900">Agent Loop</p>
                    <p className="text-xs text-gatepass-500">Opt-in fix guidance</p>
                  </div>
                  <button
                    onClick={() =>
                      toggleAgentLoop(
                        repo.name,
                        !(repo as unknown as Record<string, unknown>).agentLoopEnabled !== true,
                      )
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${(repo as unknown as Record<string, unknown>).agentLoopEnabled ? "bg-[#0891b2]" : "bg-gatepass-300 dark:bg-gatepass-600"}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(repo as unknown as Record<string, unknown>).agentLoopEnabled ? "translate-x-6" : "translate-x-1"}`}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
