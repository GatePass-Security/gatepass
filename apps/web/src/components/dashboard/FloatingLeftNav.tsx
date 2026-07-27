"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Shield,
  Video,
  MapPin,
  Wifi,
  User,
  Image as ImageIcon,
  LogOut,
  Sparkles,
} from "lucide-react";

interface Props {
  activeMenu?: string;
}

export function FloatingLeftNav({ activeMenu = "security" }: Props) {
  const [activeItem, setActiveItem] = useState(activeMenu);

  const menuItems = [
    { id: "security", label: "Security", icon: Shield, href: "/findings", activeDot: "bg-orange-400" },
    { id: "camera", label: "Camera", icon: Video, href: "/fleet" },
    { id: "location", label: "Location", icon: MapPin, href: "/benchmark" },
    { id: "wifi", label: "Wi-Fi", icon: Wifi, href: "/compliance" },
  ];

  return (
    <div className="flex flex-col justify-between h-full space-y-6">
      {/* Top Section: Flow Pills + Menu Card */}
      <div className="flex items-start gap-4">
        {/* Vertical Flow Navigation Pills */}
        <div className="flex flex-col items-center gap-3 pt-2">
          {/* 1 Flow Pill (Active / Connected line) */}
          <div className="relative flex flex-col items-center">
            <Link
              href="/dashboard"
              className="flex h-9 w-16 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white shadow-md shadow-orange-950/40 transition-transform hover:scale-105"
            >
              1 Flow
            </Link>
            {/* Connecting dot / vertical line */}
            <div className="h-4 w-[2px] bg-orange-500/60 my-1" />
            <div className="h-2 w-2 rounded-full bg-orange-400 shadow-sm" />
          </div>

          {/* 2 Flow Pill */}
          <Link
            href="/findings"
            className="flex h-9 w-16 items-center justify-center rounded-full bg-purple-600/80 text-[11px] font-bold text-white shadow-md transition-transform hover:scale-105 hover:bg-purple-600"
          >
            2 Flow
          </Link>

          {/* 3 Flow Pill */}
          <Link
            href="/fleet"
            className="flex h-9 w-16 items-center justify-center rounded-full bg-teal-500/80 text-[11px] font-bold text-slate-950 shadow-md transition-transform hover:scale-105 hover:bg-teal-400"
          >
            3 Flow
          </Link>

          {/* 4 Flow Pill */}
          <Link
            href="/compliance"
            className="flex h-9 w-16 items-center justify-center rounded-full bg-lime-400 text-[11px] font-bold text-slate-950 shadow-md transition-transform hover:scale-105 hover:bg-lime-300"
          >
            4 Flow
          </Link>
        </div>

        {/* Floating MENU Card Container */}
        <div className="w-48 rounded-3xl border border-slate-800/80 bg-slate-900/90 p-4 backdrop-blur-xl shadow-2xl">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold px-2">
            MENU
          </span>

          <div className="mt-3 space-y-1.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isSelected = activeItem === item.id;

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setActiveItem(item.id)}
                  className={`flex items-center justify-between rounded-2xl px-3 py-2.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-slate-800 text-white shadow-inner"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} className={isSelected ? "text-white" : "text-slate-400"} />
                    <span>{item.label}</span>
                  </div>

                  {item.activeDot && isSelected && (
                    <span className={`h-2 w-2 rounded-full ${item.activeDot} animate-pulse`} />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Section: Floating Icons + Get a Pro + Card */}
      <div className="flex items-end gap-3 pt-6">
        {/* Floating Icons Column */}
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-teal-500/40 bg-slate-900 text-teal-400 shadow-md">
            <User size={18} />
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900/80 text-slate-400 hover:text-white transition-colors">
            <ImageIcon size={16} />
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900/80 text-slate-400 hover:text-red-400 transition-colors">
            <LogOut size={16} />
          </div>
        </div>

        {/* Floating "Get a Pro +" Card */}
        <div className="w-52 rounded-3xl border border-slate-800/80 bg-slate-900/90 p-4 text-white backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Upgrade</div>
              <h4 className="text-sm font-bold text-white flex items-center gap-1 mt-0.5">
                <span>Get a Pro +</span>
                <Sparkles size={13} className="text-amber-400" />
              </h4>
            </div>

            {/* User Avatar Circle */}
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-0.5 shadow-md">
              <div className="h-full w-full rounded-2xl bg-slate-950 flex items-center justify-center text-xs font-bold text-amber-300">
                P+
              </div>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-slate-400 leading-tight">
            Unlock 100% deterministic AI stack guards &amp; Vanta auto-sync.
          </p>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="flex-1 rounded-full bg-teal-400 py-1.5 text-center text-xs font-bold text-slate-950 hover:bg-teal-300 transition-all shadow-md shadow-teal-950"
            >
              BUY
            </button>
            <button
              type="button"
              className="flex-1 rounded-full bg-slate-800 py-1.5 text-center text-xs font-bold text-slate-300 hover:bg-slate-700 transition-all"
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
