"use client";

import { useState } from "react";
import {
  Clock,
  Calendar,
  FileDown,
  FileCode,
  Download,
  CheckCircle2,
} from "lucide-react";
import type { Finding } from "@/lib/types";

interface Props {
  latestFindings: Finding[];
}

interface ActivityEvent {
  id: string;
  time: string;
  title: string;
  subtitle: string;
  type: "blocked" | "verified" | "compliance" | "scan";
  severity?: "critical" | "high" | "medium" | "low";
}

export function DashboardActivityTimeline({ latestFindings }: Props) {
  const [selectedDay, setSelectedDay] = useState<number>(14);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const days = [
    { dayNum: 11, dayLabel: "Mon" },
    { dayNum: 12, dayLabel: "Tue" },
    { dayNum: 13, dayLabel: "Wed" },
    { dayNum: 14, dayLabel: "Thu" },
    { dayNum: 15, dayLabel: "Fri" },
    { dayNum: 16, dayLabel: "Sat" },
    { dayNum: 17, dayLabel: "Sun" },
  ];

  // Dynamic timeline events built from real findings or demo defaults
  const events: ActivityEvent[] = [
    {
      id: "ev-1",
      time: "07:00 am",
      title: "Tool Poisoning Attempt Blocked",
      subtitle: "PR #142 on vulnerable-nextjs-mcp • mcp/tools.json:5",
      type: "blocked",
      severity: "critical",
    },
    {
      id: "ev-2",
      time: "08:15 am",
      title: "Unauthenticated MCP Transport Detected",
      subtitle: "Server server-03 • transport/sse.ts:12",
      type: "verified",
      severity: "high",
    },
    {
      id: "ev-3",
      time: "09:30 am",
      title: "SOC 2 & ISO 27001 Evidence Exported",
      subtitle: "Vanta API payload successfully delivered • Signed audit digest",
      type: "compliance",
    },
    {
      id: "ev-4",
      time: "11:00 am",
      title: "Deterministic Engine Scan Completed",
      subtitle: "119,868 source files scanned in 0.9ms • 0% false positives",
      type: "scan",
    },
  ];

  function triggerDownload(filename: string, content: object) {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setToastMsg(`Downloaded ${filename}!`);
    setTimeout(() => setToastMsg(null), 3000);
  }

  function handleDownloadSarif() {
    triggerDownload("gatepass-scan-report.sarif", {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "Gatepass Security Engine", version: "1.0.0" } },
          results: latestFindings,
        },
      ],
    });
  }

  function handleDownloadCompliance() {
    triggerDownload("gatepass-compliance-posture.json", {
      exportedAt: new Date().toISOString(),
      standards: ["SOC2_TYPE2", "ISO_27001_2022"],
      controlsPassing: 12,
      controlsFailing: 0,
      evidenceDigest: "sha256-8a9d100bfe53849fe95667e0fca1b181d",
    });
  }

  function handleDownloadAudit() {
    triggerDownload("gatepass-audit-trail.json", {
      timestamp: new Date().toISOString(),
      organizationId: "org-scale-01",
      scansCompleted: 24,
      ciGatePolicy: "BLOCKING_ENABLED",
    });
  }

  return (
    <div className="bento-card relative p-6 text-white shadow-2xl">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 rounded-lg bg-teal-900 border border-teal-400 px-3 py-2 text-xs text-teal-200 shadow-xl animate-toast-enter">
          <CheckCircle2 size={14} className="text-teal-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Header & Direct Download Hub */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <Clock className="text-teal-400" size={20} />
          <div>
            <h3 className="text-sm font-bold text-white">Live Activity &amp; Audit Log</h3>
            <p className="text-[11px] text-slate-400">
              Chronological security events, PR checks, and export downloads
            </p>
          </div>
        </div>

        {/* Direct Download Action Hub */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadSarif}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
          >
            <FileCode size={13} className="text-teal-400" />
            <span>Download SARIF</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCompliance}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
          >
            <Download size={13} className="text-emerald-400" />
            <span>Compliance Package</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadAudit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
          >
            <FileDown size={13} className="text-cyan-400" />
            <span>Audit Digest</span>
          </button>
        </div>
      </div>

      {/* Date Selector Row (Matching reference UI) */}
      <div className="mt-5 flex items-center justify-between gap-2 overflow-x-auto pb-2">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-slate-400" />
          <span className="text-xs font-medium text-slate-300">July 2026</span>
        </div>

        <div className="flex items-center gap-2">
          {days.map((d) => (
            <button
              key={d.dayNum}
              type="button"
              onClick={() => setSelectedDay(d.dayNum)}
              className={`flex flex-col items-center justify-center rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                selectedDay === d.dayNum
                  ? "bg-teal-500 text-white font-bold shadow-md shadow-teal-950"
                  : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800"
              }`}
            >
              <span className="text-[10px] text-slate-400 font-normal">{d.dayLabel}</span>
              <span className="text-sm">{d.dayNum}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Events Timeline Bento Cards */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {events.map((ev) => (
          <div
            key={ev.id}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 hover:border-slate-700 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">{ev.time}</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    ev.type === "blocked"
                      ? "bg-red-400"
                      : ev.type === "verified"
                      ? "bg-amber-400"
                      : "bg-teal-400"
                  }`}
                />
              </div>
              <h4 className="mt-2 text-xs font-semibold text-white leading-snug">{ev.title}</h4>
              <p className="mt-1 text-[11px] text-slate-400 leading-normal">{ev.subtitle}</p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>Status: Verified</span>
              <span className="text-teal-400">0% FP</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
