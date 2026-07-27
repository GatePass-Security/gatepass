"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield,
  Search,
  Server,
  BarChart3,
  FileCheck,
  Settings,
  Menu,
  X,
  Lightbulb,
  HelpCircle,
  FileText,
  LayoutDashboard,
} from "lucide-react";
import { useOrg } from "@/providers/OrgProvider";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/findings", label: "Findings", icon: Search },
  { href: "/agent-guidance", label: "Agent Guidance", icon: Lightbulb },
  { href: "/fleet", label: "Fleet", icon: Server },
  { href: "/benchmark", label: "Benchmark", icon: BarChart3 },
  { href: "/compliance", label: "Compliance", icon: FileCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

const FOOTER_ITEMS = [
  { href: "/support", label: "Support", icon: HelpCircle },
  { href: "/docs", label: "Docs", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const { org } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const planBadgeColors: Record<string, string> = {
    free: "bg-gatepass-100 text-gatepass-600",
    team: "bg-blue-50 text-blue-700",
    scale: "bg-emerald-50 text-emerald-700",
  };

  function renderNavItem(item: (typeof NAV_ITEMS)[number]) {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            isActive
              ? "bg-[#0D9488]/10 text-[#0D9488]"
              : "text-gatepass-600 hover:bg-gatepass-50 hover:text-gatepass-900"
          }`}
        >
          <item.icon
            size={16}
            className={isActive ? "text-[#0D9488]" : "text-gatepass-400"}
          />
          <span>{item.label}</span>
        </Link>
      </li>
    );
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-gatepass-200 bg-white px-4 h-14 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center rounded-lg p-2 -ml-2 text-gatepass-600 hover:bg-gatepass-100 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu size={20} />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0D9488]">
            <Shield size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-gatepass-900">
            Gatepass
          </span>
        </Link>
        <div className="w-9" />
      </header>

      {/* Mobile spacer */}
      <div className="h-14 md:hidden" />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky md:top-0 inset-y-0 left-0 z-50 flex h-screen w-60 shrink-0 flex-col border-r border-gatepass-200 bg-white transition-transform duration-200 ${
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Mobile drawer close */}
        <div className="flex items-center justify-between border-b border-gatepass-200 px-4 h-14 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0D9488]">
              <Shield size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-gatepass-900">
              Gatepass
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center rounded-lg p-2 text-gatepass-500 hover:bg-gatepass-100 transition-colors"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Brand area */}
        <div className="hidden md:flex flex-col border-b border-gatepass-200 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0D9488]">
              <Shield size={18} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-gatepass-900">
                Gatepass
              </span>
              <span className="text-xs text-gatepass-500">
                {org
                  ? `${org.planTier} tier · ${org.id}`
                  : "Deterministic AppSec"}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">{NAV_ITEMS.map(renderNavItem)}</ul>
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-gatepass-200 px-3 py-3">
          <ul className="space-y-0.5 mb-3">
            {FOOTER_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "text-[#0D9488]"
                        : "text-gatepass-500 hover:bg-gatepass-50 hover:text-gatepass-900"
                    }`}
                  >
                    <item.icon
                      size={16}
                      className={
                        isActive ? "text-[#0D9488]" : "text-gatepass-400"
                      }
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {org && (
            <div className="flex items-center gap-2 rounded-lg bg-gatepass-50 px-3 py-2 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  planBadgeColors[org.planTier] ?? planBadgeColors.free
                }`}
              >
                {org.planTier}
              </span>
              <span className="text-gatepass-600">plan active</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
