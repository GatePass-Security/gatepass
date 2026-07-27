"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown } from "lucide-react";
import { useOrg } from "@/providers/OrgProvider";

export function TopNavBar() {
  const router = useRouter();
  const { org } = useOrg();
  const [query, setQuery] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/findings?q=${encodeURIComponent(q)}` : "/findings");
  }

  const planLabel = org?.planTier ?? "free";

  return (
    <header className="flex h-14 items-center justify-between border-b border-gatepass-200 bg-white px-6">
      {/* Search */}
      <form onSubmit={submit} className="relative w-full max-w-md">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gatepass-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search findings, repos, or MCP servers…"
          className="h-9 w-full rounded-lg border border-gatepass-200 bg-gatepass-50 pl-9 pr-4 text-sm text-gatepass-900 placeholder:text-gatepass-400 focus:border-[#0D9488] focus:outline-none focus:ring-1 focus:ring-[#0D9488]"
        />
      </form>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button
          type="button"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-gatepass-200 bg-white text-gatepass-500 hover:bg-gatepass-50 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={16} />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 rounded-lg border border-gatepass-200 px-2.5 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0D9488] text-white text-xs font-bold">
            P
          </div>
          <div className="hidden sm:flex flex-col text-left">
            <span className="text-xs font-semibold text-gatepass-900">Pranav</span>
            <span className="text-[10px] text-gatepass-500 capitalize">{planLabel} tier</span>
          </div>
          <ChevronDown size={14} className="text-gatepass-400" />
        </div>
      </div>
    </header>
  );
}
