"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
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
  Radar,
  FolderGit2,
  ShieldCheck,
  ServerCog,
  Target,
} from "lucide-react";
import { useOrg } from "@/providers/OrgProvider";
import { useEffect, useState } from "react";
import { BrandLockup } from "./Brand";
import { cx } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * Grouped, because a flat list of eleven is a wall.
 *
 * The groups are the product's own vocabulary rather than invented categories:
 * you look at what was found, at what Gatepass is pointed at, at what an auditor
 * gets, and at how the deployment itself is wired. The numbered-rule treatment
 * mirrors the marketing site's "02 / DETECTIONS" section rhythm.
 */
interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Analysis",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/scans", label: "Scans", icon: Radar },
      { href: "/findings", label: "Findings", icon: Search },
      { href: "/agent-guidance", label: "Fix guidance", icon: Lightbulb },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/repos", label: "Repositories", icon: FolderGit2 },
      { href: "/fleet", label: "MCP fleet", icon: Server },
    ],
  },
  {
    label: "Assurance",
    items: [
      { href: "/compliance", label: "Compliance", icon: FileCheck },
      { href: "/evidence", label: "Evidence", icon: ShieldCheck },
      { href: "/benchmark", label: "Benchmark", icon: BarChart3 },
      // Not an analysis surface — it is the page for somebody evaluating whether this product
      // does what it says, which is a different question from "what is wrong with my code".
      { href: "/proof", label: "Proof", icon: Target },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/system", label: "System", icon: ServerCog },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const FOOTER_ITEMS: readonly NavItem[] = [
  { href: "/docs", label: "Documentation", icon: FileText },
  { href: "/support", label: "Support", icon: HelpCircle },
];

const PLAN_LABEL: Record<string, string> = { free: "Free", team: "Team", scale: "Scale" };

/** Exact match, or any route nested beneath it. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * Module scope, not nested inside Sidebar. A component declared in the parent
 * body gets a new function identity every render, so React cannot reconcile it
 * — it unmounts and remounts every nav link on every route change, which
 * destroys focus mid-navigation.
 */
function NavLink({ item, pathname, compact = false }: { item: NavItem; pathname: string; compact?: boolean }) {
  const active = isActive(pathname, item.href);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "group relative flex items-center gap-3 rounded-[0.5rem] transition-colors duration-150",
          compact ? "px-3 py-1.5 text-[0.79rem]" : "px-3 py-2 text-[0.845rem]",
          active ? "bg-raised font-medium text-fg" : "text-fg-secondary hover:bg-raised/60 hover:text-fg",
        )}
      >
        {/* The active marker is a rule, not a filled pill: the accent stays spent
            on data and state, and chrome never competes with a severity colour. */}
        {active && <span className="absolute inset-y-1.5 -left-3 w-[2px] rounded-full bg-accent" aria-hidden="true" />}
        <item.icon
          size={compact ? 15 : 16}
          className={active ? "shrink-0 text-accent" : "shrink-0 text-fg-muted group-hover:text-fg-secondary"}
        />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

/** True while the viewport is below the `md` breakpoint the rail switches at. */
function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return compact;
}

export function Sidebar() {
  const pathname = usePathname();
  const { org } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCompact = useIsCompactViewport();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  /*
   * Translating the rail off-screen hides it visually but leaves all of its
   * controls in the tab order and the accessibility tree. `inert` takes them out
   * properly — scoped to compact viewports, since on desktop the same element is
   * the static, visible rail.
   */
  const railInert = isCompact && !mobileOpen;

  return (
    <>
      {/* ── Mobile header ── */}
      <header className="gp-chrome fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-line px-3 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="cursor-pointer rounded-[0.5rem] p-2 text-fg-secondary transition-colors hover:bg-raised hover:text-fg"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <Link href="/dashboard" aria-label="Gatepass — overview">
          <BrandLockup size={24} />
        </Link>
        <span className="w-9" />
      </header>
      <div className="h-14 md:hidden" />

      {mobileOpen && (
        <button
          className="fixed inset-0 z-40 cursor-pointer bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          tabIndex={-1}
        />
      )}

      {/* ── Rail ── */}
      <aside
        inert={railInert}
        aria-hidden={railInert || undefined}
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[15.5rem] flex-col border-r border-line bg-surface",
          "transition-transform duration-300 ease-out md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-end px-3 pt-3 md:hidden">
          <button
            onClick={() => setMobileOpen(false)}
            className="cursor-pointer rounded-[0.5rem] p-2 text-fg-muted transition-colors hover:bg-raised hover:text-fg"
            aria-label="Close navigation menu"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 pt-4 pb-4 md:pt-5">
          <Link href="/dashboard" className="inline-flex rounded-[0.5rem]" aria-label="Gatepass — overview">
            <BrandLockup size={28} subtitle="Precision AppSec" />
          </Link>
        </div>

        {/* space-y-4, not 5: at four groups and eleven items the taller rhythm
            pushed Settings below the fold on a 812px phone. */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-5 pb-3" aria-label="Primary">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <h2 className="mb-1.5 px-3 text-[0.65rem] font-medium tracking-[0.11em] text-fg-muted uppercase">
                {group.label}
              </h2>
              <ul className="space-y-px">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-5 pt-3 pb-4">
          <ul className="space-y-px">
            {FOOTER_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} compact />
            ))}
          </ul>

          {org && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-[0.5rem] border border-line bg-raised px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[0.78rem] font-medium text-fg">{org.id}</span>
                <span className="block text-[0.7rem] text-fg-muted">
                  {PLAN_LABEL[org.planTier] ?? org.planTier} plan
                </span>
              </span>
              <span className="shrink-0 rounded-[0.3rem] border border-accent-line bg-accent-soft px-1.5 py-0.5 text-[0.62rem] font-medium tracking-wide text-accent uppercase">
                {org.planTier}
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
