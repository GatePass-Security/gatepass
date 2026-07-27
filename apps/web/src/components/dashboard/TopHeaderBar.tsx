"use client";

import { useState } from "react";
import {
  MapPin,
  Mic,
  Sun,
  Moon,
  Bell,
  ChevronDown,
  AudioLines,
} from "lucide-react";

export function TopHeaderBar() {
  const [darkMode, setDarkMode] = useState(true);
  const [query, setQuery] = useState("Camera 8 _");

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 py-2 text-white">
      {/* Top Left: Avatar + Title + Location Pin */}
      <div className="flex items-center gap-3">
        {/* Profile Avatar Card */}
        <div className="h-12 w-12 rounded-2xl bg-slate-900 border border-slate-800 p-0.5 shadow-md flex items-center justify-center overflow-hidden">
          <div className="h-full w-full rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center font-bold text-slate-950 text-sm">
            GP
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-black tracking-tight text-white leading-none">Home</h1>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-1">
            <MapPin size={12} className="text-teal-400" />
            <span>401 Magnetic Drive Unit 2</span>
          </div>
        </div>
      </div>

      {/* Top Center: Audio Waveform Capsule Pill (1-to-1 matching reference UI) */}
      <div className="flex items-center justify-between rounded-full border border-slate-800 bg-slate-900/90 px-4 py-2 w-full max-w-xs shadow-inner">
        <div className="flex items-center gap-2">
          <AudioLines size={16} className="text-slate-400 animate-pulse" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none w-32"
          />
        </div>

        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer">
          <Mic size={14} />
        </div>
      </div>

      {/* Top Right: Theme Switcher + Bell + Profile Pill */}
      <div className="flex items-center gap-3">
        {/* Sun / Moon Toggle Pill */}
        <div className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => setDarkMode(false)}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              !darkMode ? "bg-amber-400 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
            title="Light mode"
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDarkMode(true)}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              darkMode ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
            }`}
            title="Dark mode"
          >
            <Moon size={14} />
          </button>
        </div>

        {/* Notification Bell Circle */}
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 hover:text-white transition-colors"
          title="Notifications"
        >
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-teal-400" />
        </button>

        {/* Profile Dropdown Pill */}
        <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 p-1 pr-3">
          <div className="h-7 w-7 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 p-0.5 shadow-sm">
            <div className="h-full w-full rounded-full bg-slate-950 flex items-center justify-center text-[10px] font-bold text-amber-300">
              M
            </div>
          </div>
          <span className="text-xs font-semibold text-white">Miquella</span>
          <ChevronDown size={14} className="text-slate-400" />
        </div>
      </div>
    </header>
  );
}
