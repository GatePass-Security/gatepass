"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

export function ActivityTimelineRow() {
  const [selectedDate, setSelectedDate] = useState<number>(14);

  const days = [
    { dayNum: 11, dayLabel: "Mon" },
    { dayNum: 12, dayLabel: "Tue" },
    { dayNum: 13, dayLabel: "Wed" },
    { dayNum: 14, dayLabel: "Thu" },
    { dayNum: 15, dayLabel: "Fri" },
    { dayNum: 16, dayLabel: "Sat" },
    { dayNum: 17, dayLabel: "Sun" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
      {/* Card 1: 07:00 am Card (1-to-1 matching reference UI) */}
      <div className="md:col-span-3 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 text-white backdrop-blur-xl shadow-xl flex flex-col justify-between min-h-[160px]">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>07:00 am</span>
          <button type="button" className="text-slate-400 hover:text-white transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>

        {/* Patterned Purple Event Box */}
        <div className="mt-3 rounded-2xl bg-gradient-to-r from-purple-900/60 to-indigo-900/60 p-3.5 border border-purple-500/30 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#a855f7_1px,transparent_1px)] [background-size:8px_8px]" />
          <h4 className="text-sm font-bold text-white relative z-10">Home</h4>
          <p className="text-xs text-purple-200 relative z-10 mt-0.5">Back Door was Closed</p>
        </div>

        {/* Bottom Timeline Indicator Line */}
        <div className="mt-3 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-slate-950 border-2 border-slate-400" />
          <div className="h-[2px] flex-1 bg-slate-800" />
        </div>
      </div>

      {/* Card 2: 08:00 am Card (1-to-1 matching reference UI) */}
      <div className="md:col-span-3 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 text-white backdrop-blur-xl shadow-xl flex flex-col justify-between min-h-[160px]">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>08:00 am</span>
          <button type="button" className="text-slate-400 hover:text-white transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>

        <div className="mt-3 py-2">
          <h4 className="text-xl font-bold text-white">Home</h4>
          <p className="text-xs text-slate-400 mt-1">Back Door was Opened</p>
        </div>

        <div className="h-1 w-full bg-slate-800 rounded-full" />
      </div>

      {/* Card 3: Activity Date Selector Card (1-to-1 matching reference UI) */}
      <div className="md:col-span-6 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 text-white backdrop-blur-xl shadow-xl flex flex-col justify-between min-h-[160px]">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white">Activity</h4>
            <p className="text-[11px] text-slate-400">December 03, 2026</p>
          </div>

          <button type="button" className="text-slate-400 hover:text-white transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>

        {/* 7-Day Calendar Selector Row */}
        <div className="mt-4 flex items-center justify-between gap-1 overflow-x-auto">
          {days.map((d) => {
            const isSelected = selectedDate === d.dayNum;

            return (
              <button
                key={d.dayNum}
                type="button"
                onClick={() => setSelectedDate(d.dayNum)}
                className={`flex flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-slate-800 border border-teal-500/60 shadow-lg text-white"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <span className="text-sm font-bold">{d.dayNum}</span>
                <span className="text-[10px] font-normal text-slate-400 mt-0.5">{d.dayLabel}</span>
                {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-teal-400 mt-1" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
