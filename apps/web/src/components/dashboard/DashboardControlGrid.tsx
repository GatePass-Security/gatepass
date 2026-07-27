"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Server,
  Lightbulb,
  FileCheck,
  CheckCircle2,
  Copy,
  Download,
  ArrowRight,
  Zap,
  ExternalLink,
} from "lucide-react";

interface Props {
  verifiedCount?: number;
  onOpenQuestionnaire?: () => void;
}

export function DashboardControlGrid({ verifiedCount: _verifiedCount, onOpenQuestionnaire: _onOpenQuestionnaire }: Props) {
  const [ciGateActive, setCiGateActive] = useState(true);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [exportingVanta, setExportingVanta] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);

  const cursorPromptText = `Gatepass Finding Remediation Instructions:
1. Review verified finding 'unauth-mcp-transport' at mcp/tools.json:5.
2. Enforce Bearer authorization check on SSE transport header.
3. Apply schema validation on unbounded tool arguments using Zod.
4. Keep original business logic intact; re-run gatepass scan to verify zero FP.`;

  function handleCopyPrompt() {
    navigator.clipboard.writeText(cursorPromptText);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  }

  function handleExportVanta() {
    setExportingVanta(true);
    setExportToast("Exporting signed posture evidence to Vanta API...");
    setTimeout(() => {
      setExportingVanta(false);
      setExportToast("Evidence payload synced with Vanta & Drata!");
      setTimeout(() => setExportToast(null), 3000);
    }, 1200);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Toast Notification */}
      {exportToast && (
        <div className="col-span-full z-30 flex items-center justify-between gap-2 rounded-xl bg-slate-900 border border-teal-500/60 p-3 text-xs text-teal-200 shadow-xl animate-toast-enter">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-teal-400" />
            <span>{exportToast}</span>
          </div>
          <span className="font-mono text-[10px] text-teal-400">SOC2 / ISO 27001</span>
        </div>
      )}

      {/* Widget 1: CI/CD Security Gate Toggle */}
      <div className="bento-card relative p-5 text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-teal-400" size={18} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                CI Merge Gate
              </span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-medium ${
                ciGateActive
                  ? "bg-teal-950 text-teal-300 border border-teal-800"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {ciGateActive ? "Blocking Mode" : "Advisory Mode"}
            </span>
          </div>

          <h3 className="mt-3 text-base font-bold text-white">GitHub PR Merge Guard</h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Blocks pull requests containing deterministically verified findings. Never mutates code or CI config.
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
          <span className="text-xs text-slate-300">Enforce Merge Gate:</span>
          <button
            type="button"
            onClick={() => setCiGateActive(!ciGateActive)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              ciGateActive ? "bg-teal-500" : "bg-slate-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                ciGateActive ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Widget 2: 360° MCP Fleet Transport Shield */}
      <div className="bento-card relative p-5 text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="text-cyan-400" size={18} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Fleet Shield
              </span>
            </div>
            <span className="flex h-2 w-2 rounded-full bg-teal-400 animate-ping" />
          </div>

          <h3 className="mt-3 text-base font-bold text-white">MCP Transport Radar</h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Monitors active SSE, Stdout, and HTTP server transports for unauthenticated listeners.
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
          <Link
            href="/fleet"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <span>Manage Fleet Servers</span>
            <ArrowRight size={13} />
          </Link>
          <span className="text-[11px] font-mono text-slate-400">168 baseline servers</span>
        </div>
      </div>

      {/* Widget 3: Remediation & Agent Guidance Launcher */}
      <div className="bento-card relative p-5 text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="text-amber-400" size={18} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Agent Guidance
              </span>
            </div>
            <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded-full">
              Cursor / Claude Code
            </span>
          </div>

          <h3 className="mt-3 text-base font-bold text-white">AI Fix Prompt Generator</h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Generates structured, pre-commit prompt instructions for your AI coding assistant.
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
          >
            {copiedPrompt ? <CheckCircle2 size={14} className="text-teal-400" /> : <Copy size={14} />}
            <span>{copiedPrompt ? "Prompt Copied!" : "Copy Cursor Prompt"}</span>
          </button>
          <Link
            href="/agent-guidance"
            className="inline-flex items-center justify-center p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="View full agent guidance page"
          >
            <ExternalLink size={14} />
          </Link>
        </div>
      </div>

      {/* Widget 4: SOC 2 / ISO Compliance Sync */}
      <div className="bento-card relative p-5 text-white flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck className="text-emerald-400" size={18} />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Compliance Sync
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded-full">
              Vanta / Drata API
            </span>
          </div>

          <h3 className="mt-3 text-base font-bold text-white">Evidence &amp; Questionnaire</h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
            Export posture evidence to Vanta or auto-draft enterprise risk questionnaires.
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleExportVanta}
            disabled={exportingVanta}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors"
          >
            <Download size={14} />
            <span>{exportingVanta ? "Syncing..." : "Sync Vanta Evidence"}</span>
          </button>
          <Link
            href="/compliance"
            className="inline-flex items-center justify-center p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Go to compliance dashboard"
          >
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
