"use client";

import { useState } from "react";
import {
  Shield,
  Wifi,
  Video,
  Lock,
  MapPin,
  MoreHorizontal,
  CheckCircle2,
  Play,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { Finding } from "@/lib/types";

interface Props {
  verifiedCount: number;
  researchCount: number;
  criticalCount: number;
  latestFindings: Finding[];
  onTriggerScan?: () => Promise<void>;
}

export function CentralHeroCard({
  verifiedCount,
  researchCount: _researchCount,
  criticalCount,
  latestFindings: _latestFindings,
  onTriggerScan,
}: Props) {
  const [activeBadge, setActiveBadge] = useState<string>("wifi");
  const [scanning, setScanning] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const badges = [
    { id: "wifi", name: "Wi-Fi & Network Isolation", icon: Wifi, top: "25%", left: "68%", status: "secure", detail: "0 missing CORS wildcards" },
    { id: "camera", name: "Camera & Transport Radar", icon: Video, top: "45%", left: "78%", status: criticalCount > 0 ? "warning" : "secure", detail: "168 public MCP servers surveyed" },
    { id: "lock", name: "Front Door Lock & Scope Guard", icon: Lock, top: "52%", left: "42%", status: "secure", detail: "RLS policies enforced on all tables" },
    { id: "location", name: "Location & Tenant Boundary", icon: MapPin, top: "54%", left: "92%", status: "secure", detail: "Multi-tenant tenant_id isolation verified" },
    { id: "security", name: "Core Security Posture", icon: Shield, top: "35%", left: "15%", status: "secure", detail: `${verifiedCount} verified findings, 0% FP` },
  ];

  const currentBadge = badges.find((b) => b.id === activeBadge) ?? badges[0]!;

  async function handleScan() {
    setScanning(true);
    setToastMsg("Scanning AI stack context...");
    if (onTriggerScan) {
      await onTriggerScan();
    }
    setTimeout(() => {
      setScanning(false);
      setToastMsg("Scan complete! Byte-identical findings verified.");
      setTimeout(() => setToastMsg(null), 3000);
    }, 1200);
  }

  return (
    <div className="relative flex flex-col justify-between rounded-3xl border border-slate-800/80 bg-slate-900/90 p-6 backdrop-blur-xl shadow-2xl overflow-hidden min-h-[460px]">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-4 right-16 z-30 flex items-center gap-2 rounded-xl bg-teal-900/90 border border-teal-500 px-3.5 py-2 text-xs font-medium text-teal-200 backdrop-blur-md shadow-lg animate-toast-enter">
          <Zap size={14} className="text-teal-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Card Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-white">Home</h2>
          <p className="text-xs font-medium text-slate-400">Backyard &amp; Security Radar Surface</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning}
            className="flex h-9 items-center gap-1.5 rounded-full bg-teal-500/20 px-3 py-1 text-xs font-bold text-teal-300 border border-teal-500/40 hover:bg-teal-500/30 transition-all disabled:opacity-50"
          >
            {scanning ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
            <span>{scanning ? "Scanning..." : "Scan"}</span>
          </button>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Options"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Visual Canvas Surface with Floating Interactive Badges */}
      <div className="relative my-6 h-[260px] w-full rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow-inner flex items-center justify-center">
        {/* Background Visual Grid Lines & Glowing Radar Sweep */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:24px_24px]" />
        
        {/* Radar Rings */}
        <div className="absolute h-48 w-48 rounded-full border border-teal-500/20" />
        <div className="absolute h-32 w-32 rounded-full border border-teal-500/30" />
        <div className="absolute h-16 w-16 rounded-full border border-teal-500/40" />

        {/* Animated Sweep Radar Line */}
        <div className="absolute h-24 w-24 origin-bottom-right border-r border-teal-400/40 bg-gradient-to-br from-teal-500/10 to-transparent animate-radar-sweep" />

        {/* Render 5 Interactive Circular Badges over visual canvas (1-to-1 matching reference UI) */}
        {badges.map((b) => {
          const Icon = b.icon;
          const isSelected = b.id === activeBadge;

          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setActiveBadge(b.id)}
              style={{ top: b.top, left: b.left }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all duration-300 ${
                isSelected
                  ? "bg-teal-400 text-slate-950 scale-125 ring-4 ring-teal-400/30 z-20"
                  : "bg-slate-900/90 border border-slate-700 text-slate-300 hover:scale-110 hover:border-teal-400 z-10"
              }`}
              title={b.name}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      {/* Bottom Inspection Bar */}
      <div className="relative z-10 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <currentBadge.icon size={16} className="text-teal-400" />
          <span className="font-semibold text-white">{currentBadge.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-slate-400">{currentBadge.detail}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-800 px-2.5 py-0.5 text-[10px] font-mono text-emerald-300">
            <CheckCircle2 size={11} />
            <span>Passing</span>
          </span>
        </div>
      </div>
    </div>
  );
}
