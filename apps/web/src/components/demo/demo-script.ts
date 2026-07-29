/**
 * The guided product tour.
 *
 * This drives the REAL application — real clicks on real controls, hitting the real API. Nothing
 * here is a mock or a screen recording, which is the point: a viewer can pause at any frame and
 * the thing on screen is the product doing the work.
 *
 * Budget discipline matters more than any individual step. `DEMO_BUDGET_MS` is a hard ceiling;
 * the runner scales dwell times down if real navigation or a real scan runs long, and stops
 * outright at the ceiling. Keep the sum of `ms` comfortably under it so there is headroom.
 */

/** Hard ceiling. A YC demo video is three minutes; we finish inside it. */
export const DEMO_BUDGET_MS = 180_000;

/** How a step finds the element it wants to act on. */
export interface Target {
  /** CSS selector. Tried first when present. */
  css?: string;
  /** Visible text, matched case-insensitively as a substring. */
  text?: string;
  /** Restricts a `text` search. Defaults to interactive elements. */
  scope?: string;
  /** Index when several elements match. Defaults to the first. */
  nth?: number;
}

/**
 * How long to keep looking for a target before giving up on the step.
 *
 * The default covers a client-side route change. Anything that waits on real server work needs
 * its own, larger value — a path scan through the API takes about ten seconds end to end, and a
 * step that gave up at four killed the whole merge-gate chapter with it.
 */
export const DEFAULT_WAIT_MS = 4_500;

export type Step =
  /** Hold on the current view and narrate. */
  | { kind: "say"; chapter: string; say: string; ms: number }
  /** Move the cursor to an element and click it for real. */
  | { kind: "click"; chapter: string; say?: string; target: Target; ms: number; settle?: number; waitMs?: number }
  /** Type into a field, character by character. */
  | { kind: "type"; chapter: string; say?: string; target: Target; value: string; ms: number; waitMs?: number }
  /** Choose an option in a native <select>. */
  | { kind: "select"; chapter: string; say?: string; target: Target; value: string; ms: number; waitMs?: number }
  /** Bring an element into view and point at it. */
  | { kind: "point"; chapter: string; say: string; target: Target; ms: number; waitMs?: number }
  /**
   * Wait for real work to finish. Unlike the others, the waiting IS the screen time — the caption
   * holds while the server works, so `ms` is only the beat after the target appears.
   */
  | { kind: "await"; chapter: string; say?: string; target: Target; ms: number; waitMs?: number };

/** Sidebar link, by its accessible name. Navigation is shown, never teleported. */
const nav = (label: string): Target => ({ css: `nav[aria-label="Primary"] a`, text: label });

export interface ScriptContext {
  /**
   * A directory the API host can read, used for the live scan. Resolved at run time from the
   * most recent scan so the demo always points at a path that actually exists on this machine.
   */
  scanPath?: string;
}

export function buildDemoScript({ scanPath }: ScriptContext): Step[] {
  const steps: Step[] = [
    /* ── 01 · What this is ─────────────────────────────────────────── */
    {
      kind: "say",
      chapter: "Overview",
      say: "Gatepass is a deterministic security scanner for AI-generated and agentic code. No model in the merge gate.",
      ms: 5200,
    },
    {
      kind: "point",
      chapter: "Overview",
      say: "Every number on this dashboard came out of a real scan of a real repository.",
      target: { css: "h1" },
      ms: 4200,
    },
    {
      kind: "point",
      chapter: "Overview",
      say: "Verified findings carry a reproduction. Research findings carry a confidence score. Nothing else is allowed in.",
      target: { text: "Latest findings", scope: "h2,h3" },
      ms: 5600,
    },

    /* ── 02 · A real scan, run live ────────────────────────────────── */
    {
      kind: "click",
      chapter: "Run a scan",
      say: "Point it at a repository.",
      target: { text: "Scan a repo", scope: "button" },
      ms: 3000,
      settle: 500,
    },
  ];

  // The live scan only runs if we know a path this API host can actually read.
  if (scanPath) {
    steps.push(
      {
        kind: "click",
        chapter: "Run a scan",
        say: "A GitHub repo the App can read, or a directory on the host.",
        target: { css: '[role="radio"]', text: "Path on host" },
        ms: 3000,
      },
      {
        kind: "type",
        chapter: "Run a scan",
        target: { css: 'input[placeholder="/srv/checkouts/my-app"]' },
        value: scanPath,
        ms: 3200,
      },
      {
        kind: "click",
        chapter: "Run a scan",
        say: "This is the real engine — tree-sitter parse, twelve detectors, cross-surface correlation.",
        target: { text: "Run scan", scope: "button" },
        ms: 2600,
      },
      /*
       * A full parse of a real tree takes tens of seconds, which is a third of this video to
       * spend on a spinner. So the scan is started here, on camera, and left to run against the
       * API while the tour carries on — the closing chapter comes back and opens its result. The
       * request is not bound to this dialog, so dismissing it does not cancel the work.
       */
      {
        kind: "click",
        chapter: "Run a scan",
        say: "That scan is running now. We will come back to its result at the end — meanwhile, here is one that finished.",
        target: { css: 'button[aria-label="Close dialog"]' },
        ms: 4200,
      },
      { kind: "click", chapter: "Run a scan", target: nav("Scans"), ms: 2400, settle: 800 },
      {
        kind: "click",
        chapter: "Run a scan",
        say: "Every scan this organization has run, newest first.",
        target: { text: "Open", scope: "a" },
        ms: 2800,
        settle: 900,
      },
    );
  } else {
    // No readable path — close the dialog and show a scan that already exists instead.
    steps.push(
      {
        kind: "click",
        chapter: "Run a scan",
        target: { css: 'button[aria-label="Close dialog"]' },
        ms: 1200,
      },
      { kind: "click", chapter: "Run a scan", target: nav("Scans"), ms: 3000, settle: 700 },
      {
        kind: "click",
        chapter: "Run a scan",
        say: "Every scan this org has run, newest first.",
        target: { text: "Open", scope: "a" },
        ms: 3000,
        settle: 900,
      },
    );
  }

  steps.push(
    /* ── 03 · The merge gate ───────────────────────────────────────── */
    {
      kind: "point",
      chapter: "Merge gate",
      say: "Here is the scan. Severity, tier, and the gate policy this repo would be held to.",
      target: { text: "Merge gate", scope: "h2,h3" },
      ms: 4600,
    },
    {
      kind: "select",
      chapter: "Merge gate",
      say: "Try a policy before you turn it on.",
      target: { css: "select" },
      value: "Block on any verified finding",
      ms: 3400,
    },
    {
      kind: "click",
      chapter: "Merge gate",
      target: { text: "Evaluate against this scan", scope: "button" },
      ms: 3200,
      settle: 700,
    },
    {
      kind: "point",
      chapter: "Merge gate",
      say: "It would block this merge — and it tells you that before it ever blocks a developer.",
      target: { css: '[aria-live="polite"]' },
      ms: 4600,
    },
    {
      kind: "click",
      chapter: "Merge gate",
      say: "Export SARIF straight into GitHub code scanning.",
      target: { text: "SARIF", scope: "button" },
      ms: 3600,
    },

    /* ── 04 · Triage ───────────────────────────────────────────────── */
    { kind: "click", chapter: "Findings", target: nav("Findings"), ms: 2800, settle: 900 },
    {
      kind: "click",
      chapter: "Findings",
      say: "Filter by tier and severity.",
      target: { css: "[aria-pressed]", text: "Critical" },
      ms: 3400,
    },
    {
      kind: "click",
      chapter: "Findings",
      say: "Open a finding and you get the reproduction: the file, the line, the commit.",
      target: { css: 'button[aria-label^="Expand details"]' },
      ms: 4400,
      settle: 500,
    },
    {
      /* The expanded panel is the reliable anchor. Its sections vary by finding — a research-tier
         result carries a confidence meter where a verified one carries a reproduction — so
         pointing at any single heading skips whenever the first card happens to be the other kind. */
      kind: "point",
      chapter: "Findings",
      say: "The reproduction, the surfaces it touches, and the fix — ready to copy.",
      target: { css: '[id^="finding-detail-"]' },
      ms: 4000,
    },
    {
      kind: "click",
      chapter: "Findings",
      say: "Disagree with a finding? Dispute it, and the dispute is audited.",
      target: { text: "Dispute", scope: "button" },
      ms: 3800,
    },

    /* ── 05 · Remediation ──────────────────────────────────────────── */
    { kind: "click", chapter: "Fix guidance", target: nav("Fix guidance"), ms: 2600, settle: 900 },
    {
      kind: "click",
      chapter: "Fix guidance",
      say: "Pick any finding from any scan.",
      target: { css: 'input[type="radio"][name="finding"]' },
      ms: 2600,
    },
    {
      kind: "click",
      chapter: "Fix guidance",
      say: "The agent loop returns remediation steps for that exact finding — not generic advice.",
      target: { text: "Get guidance", scope: "button" },
      ms: 5200,
      settle: 1200,
    },

    /* ── 06 · Inventory ────────────────────────────────────────────── */
    {
      kind: "click",
      chapter: "Inventory",
      say: "Every repository the App can read. Contents read-only — Gatepass never writes to your code or your CI.",
      target: nav("Repositories"),
      ms: 5000,
      settle: 800,
    },
    {
      kind: "click",
      chapter: "Inventory",
      say: "Your MCP servers, and the posture of each one.",
      target: nav("MCP fleet"),
      ms: 4200,
      settle: 800,
    },
    /* Registering one rather than filtering an empty list: a fresh deployment has no servers, and
       a tour that quietly skips its own steps on a clean install is not a tour. */
    { kind: "click", chapter: "Inventory", target: { text: "Add server", scope: "button" }, ms: 2400 },
    {
      kind: "type",
      chapter: "Inventory",
      say: "Register a server and Gatepass tracks it by config hash, not by name.",
      target: { css: 'input[placeholder="payments-mcp"]' },
      value: "payments-mcp",
      ms: 2600,
    },
    {
      kind: "type",
      chapter: "Inventory",
      target: { css: 'input[placeholder="/srv/repos/payments-mcp"]' },
      value: "/srv/repos/payments-mcp",
      ms: 2400,
    },
    {
      kind: "click",
      chapter: "Inventory",
      target: { text: "Register server", scope: "button" },
      ms: 2600,
      settle: 900,
    },
    {
      kind: "click",
      chapter: "Inventory",
      say: "Config hash, last scan, and the server's identity — the audit trail for a fleet you did not write.",
      target: { text: "Details", scope: "button" },
      ms: 4000,
    },

    /* ── 07 · Assurance ────────────────────────────────────────────── */
    /* Unlike every other route, /compliance runs a real compliance scan server-side on request,
       so it arrives seconds after the click. The following steps wait it out rather than firing
       into the previous page and skipping themselves. */
    {
      kind: "click",
      chapter: "Compliance",
      say: "WCAG, CCPA, App Store, Play Store, EU AI Act — computed against your code, not answered from a template.",
      target: nav("Compliance"),
      ms: 5600,
      settle: 2200,
    },
    {
      kind: "click",
      chapter: "Compliance",
      say: "Contrast ratios are actually calculated. A check that cannot be proven is marked manual, not passed.",
      target: { css: '[role="radio"]', text: "Failing" },
      waitMs: 20_000,
      ms: 4800,
    },
    {
      kind: "click",
      chapter: "Compliance",
      say: "Each check opens to the exact locations and the change that fixes it.",
      target: { css: 'button[aria-expanded="false"]', nth: 1 },
      waitMs: 10_000,
      ms: 4400,
    },
    {
      kind: "click",
      chapter: "Evidence",
      say: "The same findings become control coverage an auditor will accept.",
      target: nav("Evidence"),
      ms: 4600,
      settle: 1000,
    },
    {
      kind: "point",
      chapter: "Evidence",
      say: "Every row cites the scan and the ruleset version it came from.",
      target: { text: "SOC 2", scope: "th,h2,h3" },
      ms: 4000,
    },
    {
      kind: "click",
      chapter: "Evidence",
      say: "Push it into Vanta or Drata, or draft the security questionnaire from the same evidence.",
      target: { text: "Draft answers", scope: "button" },
      ms: 5000,
      settle: 800,
    },

    /* ── 08 · Proof ────────────────────────────────────────────────── */
    {
      kind: "click",
      chapter: "Benchmark",
      say: "And we publish our own precision. Same corpus, same scoring, every tool — including the analysis time.",
      target: nav("Benchmark"),
      ms: 5400,
      settle: 900,
    },
    {
      kind: "click",
      chapter: "System",
      say: "Every route this deployment answers, including the machine-to-machine ones no person clicks.",
      target: nav("System"),
      ms: 4800,
      settle: 900,
    },

    /* ── 09 · Back to the scan we started ──────────────────────────── */
    { kind: "click", chapter: "Full circle", target: nav("Scans"), ms: 2400, settle: 900 },
    {
      kind: "click",
      chapter: "Full circle",
      say: "And there is the scan we kicked off at the start — finished, with its findings and its gate decision.",
      target: { text: "Open", scope: "a" },
      ms: 5200,
      settle: 900,
    },
    {
      kind: "say",
      chapter: "Full circle",
      say: "Twelve of twelve classes. Ninety-two of ninety-three cases, zero false positives, byte-identical every run.",
      ms: 5600,
    },
  );

  return fitToBudget(steps);
}

/** Planned runtime, for the budget assertion in the runner and in tests. */
export function plannedDurationMs(steps: Step[]): number {
  return steps.reduce((total, s) => total + s.ms + ("settle" in s && s.settle ? s.settle : 0), 0);
}

/**
 * Dwell budget the authored script is fitted to.
 *
 * Well under `DEMO_BUDGET_MS` on purpose: route changes, data fetches and the cursor's own travel
 * add roughly half a minute of wall-clock that no amount of scaling can compress. Fitting the
 * readable-pace script into this leaves that headroom, so the closing chapter actually plays
 * instead of being cut off at the ceiling.
 */
const TARGET_DWELL_MS = 112_000;

/** Shortest a caption can hold and still be readable on video. */
const MIN_DWELL_MS = 1_900;

function fitToBudget(steps: Step[]): Step[] {
  const total = plannedDurationMs(steps);
  if (total <= TARGET_DWELL_MS) return steps;
  const k = TARGET_DWELL_MS / total;
  return steps.map((step) => {
    const scaled: Step = { ...step, ms: Math.max(MIN_DWELL_MS, Math.round(step.ms * k)) };
    if ("settle" in scaled && scaled.settle) scaled.settle = Math.round(scaled.settle * k);
    return scaled;
  });
}
