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
  Upload,
} from "lucide-react";
import { useOrg } from "@/providers/OrgProvider";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/findings", label: "Findings", icon: Search },
  { href: "/agent-guidance", label: "Guidance", icon: Lightbulb },
  { href: "/fleet", label: "Fleet", icon: Server },
  { href: "/benchmark", label: "Benchmark", icon: BarChart3 },
  { href: "/compliance", label: "Compliance", icon: FileCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

const FOOTER_ITEMS = [
  { href: "/support", label: "Support", icon: HelpCircle },
  { href: "/docs", label: "Documentation", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const { org } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile nav on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile nav is open
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
    team: "bg-blue-100 text-blue-700",
    scale: "bg-emerald-100 text-emerald-700",
  };

  // Shared nav item render logic
  function renderNavItem(item: {
    href: string;
    label: string;
    icon: React.ComponentType<{ size: number; className?: string }>;
  }) {
    const isActive = pathname.startsWith(item.href);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors duration-150 ${
            isActive
              ? "border-l-[3px] border-l-[#0D9488] bg-teal-50 text-[#0D9488] dark:bg-teal-950/40"
              : "border-l-[3px] border-l-transparent text-gatepass-600 hover:bg-gatepass-50 hover:text-gatepass-900 dark:text-gatepass-300 dark:hover:bg-gatepass-800 dark:hover:text-gatepass-100"
          }`}
        >
          <item.icon size={20} className={`shrink-0 ${isActive ? "text-[#0D9488]" : "text-gatepass-400"}`} />
          <span>{item.label}</span>
        </Link>
      </li>
    );
  }

  return (
    <>
      {/* ── Mobile top bar ── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-gatepass-200 bg-white px-4 h-14 md:hidden dark:border-gatepass-800 dark:bg-gatepass-900">
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
          <span className="text-sm font-semibold text-gatepass-900">Gatepass</span>
        </Link>

        <div className="w-9" />
      </header>

      {/* ── Spacer for mobile top bar ── */}
      <div className="h-14 md:hidden" />

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gatepass-200 bg-white transition-transform duration-300 ease-out dark:border-gatepass-800 dark:bg-gatepass-900 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } shadow-xl md:shadow-none`}
      >
        {/* Mobile drawer header */}
        <div className="flex items-center justify-between border-b border-gatepass-200 px-4 h-14 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0D9488]">
              <Shield size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-gatepass-900">Gatepass</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center rounded-lg p-2 text-gatepass-500 hover:bg-gatepass-100 transition-colors"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Desktop brand area */}
        <div className="hidden md:flex flex-col border-b border-gatepass-200 px-4 py-5 dark:border-gatepass-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0D9488]">
              <Shield size={18} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold text-gatepass-900 dark:text-gatepass-100">Gatepass</span>
              <span className="text-xs text-gatepass-500 capitalize">
                {org ? `${org.planTier} tier` : "Precision AppSec"}
              </span>
            </div>
          </div>
          {org && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium text-gatepass-500">{org.id}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${planBadgeColors[org.planTier] ?? planBadgeColors.free}`}
              >
                {org.planTier}
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">{NAV_ITEMS.map(renderNavItem)}</ul>
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-gatepass-200 px-3 py-4 dark:border-gatepass-800">
          <ul className="space-y-1 mb-4">
            {FOOTER_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? "text-[#0D9488]"
                        : "text-gatepass-600 hover:bg-gatepass-50 hover:text-gatepass-900 dark:text-gatepass-300 dark:hover:bg-gatepass-800 dark:hover:text-gatepass-100"
                    }`}
                  >
                    <item.icon size={18} className={`shrink-0 ${isActive ? "text-[#0D9488]" : "text-gatepass-400"}`} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#0D9488] px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#0F766E]">
            <Upload size={16} />
            Upgrade Plan
          </button>
        </div>
      </aside>
    </>
  );
}
