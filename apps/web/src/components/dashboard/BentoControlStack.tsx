"use client";

import { useState } from "react";
import {
  Video,
  Power,
  Lock,
  Unlock,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";

export function BentoControlStack() {
  const [cameraActive, setCameraActive] = useState(true);
  const [radarActive, setRadarActive] = useState(false);
  const [verticalLockState, setVerticalLockState] = useState<"locked" | "unlocked">("locked");
  const [horizontalLockState, setHorizontalLockState] = useState<"locked" | "unlocked">("locked");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  function toggleVerticalLock() {
    const next = verticalLockState === "locked" ? "unlocked" : "locked";
    setVerticalLockState(next);
    setToastMsg(`Scope Guard: ${next.toUpperCase()}`);
    setTimeout(() => setToastMsg(null), 2500);
  }

  function toggleHorizontalLock() {
    const next = horizontalLockState === "locked" ? "unlocked" : "locked";
    setHorizontalLockState(next);
    setToastMsg(`MCP Transport Lock: ${next.toUpperCase()}`);
    setTimeout(() => setToastMsg(null), 2500);
  }

  return (
    <div className="relative grid grid-cols-2 gap-4">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="col-span-full z-30 flex items-center justify-between rounded-2xl bg-slate-900 border border-teal-500/60 p-3 text-xs text-teal-200 shadow-xl animate-toast-enter">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-teal-400" />
            <span className="font-semibold">{toastMsg}</span>
          </div>
          <span className="font-mono text-[10px] text-teal-400">100% Guard</span>
        </div>
      )}

      {/* Card 1 (Top-Left): Purple Accent Card (1-to-1 matching reference UI) */}
      <div className="relative flex flex-col justify-between rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 p-5 text-white shadow-xl min-h-[210px]">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
            <Video size={18} />
          </div>
          <span className="rounded-full bg-white/25 px-3 py-0.5 text-xs font-bold backdrop-blur-md">
            {cameraActive ? "On" : "Off"}
          </span>
        </div>

        <div>
          <h3 className="text-2xl font-black tracking-tight">Camera</h3>
          <p className="text-xs font-medium text-purple-100 opacity-90 mt-0.5">12 pm - 6 pm</p>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setCameraActive(!cameraActive)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              cameraActive ? "bg-white" : "bg-purple-900/60"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full shadow ring-0 transition duration-200 ease-in-out ${
                cameraActive ? "translate-x-5 bg-purple-600" : "translate-x-0 bg-white"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Card 2 (Top-Right): Dark 360° Camera Radar Dial Card (1-to-1 matching reference UI) */}
      <div className="relative flex flex-col justify-between rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl min-h-[210px]">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-teal-400">
            <Video size={18} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-mono">Off</span>
            <button
              type="button"
              onClick={() => setRadarActive(!radarActive)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                radarActive ? "bg-teal-500 text-slate-950" : "bg-purple-900/80 text-purple-200"
              }`}
            >
              <Power size={14} />
            </button>
          </div>
        </div>

        {/* Center 360° Camera Arc Sweep Graphic */}
        <div className="relative my-2 flex flex-col items-center justify-center">
          <span className="text-[9px] font-mono text-slate-400 absolute -top-1">360°</span>
          {/* Dashed Arc */}
          <div className="h-16 w-24 rounded-t-full border-t-2 border-dashed border-teal-400/60 flex items-center justify-center pt-2">
            <Video size={22} className="text-white" />
          </div>
          {/* Slider Tick Mark */}
          <div className="h-1.5 w-12 rounded-full bg-teal-400 mt-1" />
        </div>

        {/* Bottom Status Indicators */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>Date</span>
          <span className="text-teal-400 font-bold">Auto</span>
          <span>Time</span>
        </div>
      </div>

      {/* Card 3 (Bottom-Left): Dark Vertical Lock Slider Card (1-to-1 matching reference UI) */}
      <div className="relative flex flex-col justify-between rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl min-h-[220px]">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-teal-400">
            <Lock size={18} />
          </div>
          <button type="button" className="text-slate-400 hover:text-white transition-colors">
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* Center Vertical Slider Track */}
        <div className="my-3 flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={toggleVerticalLock}
            className="flex flex-col items-center justify-between rounded-full bg-slate-900 border border-slate-800 p-2 h-28 w-12 hover:border-teal-400/60 transition-all shadow-inner"
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                verticalLockState === "locked" ? "bg-white text-slate-950 shadow-md" : "bg-slate-800 text-slate-400"
              }`}
            >
              <Lock size={14} />
            </div>

            <div className="flex flex-col items-center text-slate-500 my-1">
              <ChevronDown size={12} />
              <ChevronDown size={12} className="-mt-1.5" />
            </div>

            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                verticalLockState === "unlocked" ? "bg-teal-400 text-slate-950 shadow-md" : "bg-slate-800 text-slate-400"
              }`}
            >
              <Unlock size={14} />
            </div>
          </button>
        </div>

        <div className="text-center text-[11px] font-semibold text-slate-300">
          Scope Guard Track
        </div>
      </div>

      {/* Card 4 (Bottom-Right): Teal Front Door Lock Card (1-to-1 matching reference UI) */}
      <div className="relative flex flex-col justify-between rounded-3xl bg-emerald-300 p-5 text-slate-950 shadow-xl min-h-[220px]">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/60 text-slate-950">
            <Lock size={18} />
          </div>
          <button type="button" className="text-slate-800 hover:text-slate-950 transition-colors">
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div>
          <h3 className="text-xl font-black tracking-tight leading-tight">Front Door Lock</h3>
          <p className="text-xs font-bold text-slate-800 mt-0.5 capitalize">{horizontalLockState}</p>
        </div>

        {/* Horizontal Slide-to-Unlock Bar */}
        <button
          type="button"
          onClick={toggleHorizontalLock}
          className="flex items-center justify-between rounded-full bg-emerald-200/80 p-1.5 border border-emerald-400/40 hover:border-slate-950 transition-all"
        >
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
              horizontalLockState === "locked" ? "bg-slate-950 text-emerald-300" : "bg-emerald-400 text-slate-950"
            }`}
          >
            <Lock size={14} />
          </div>

          <div className="flex items-center text-slate-700 font-bold text-xs">
            <ChevronRight size={14} />
            <ChevronRight size={14} className="-ml-2" />
            <ChevronRight size={14} className="-ml-2" />
          </div>

          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
              horizontalLockState === "unlocked" ? "bg-slate-950 text-emerald-300" : "bg-emerald-400/40 text-slate-800"
            }`}
          >
            <Unlock size={14} />
          </div>
        </button>
      </div>
    </div>
  );
}
