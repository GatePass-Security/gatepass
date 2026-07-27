"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Reveal } from "@/components/landing/motion";

type Severity = "critical" | "high" | "medium";

interface Detection {
  id: string;
  title: string;
  severity: Severity;
  asi: string;
  blurb: string;
  /** Full-bleed image shown by default in the card and darkened on hover. */
  image: string;
}

const DETECTIONS: Detection[] = [
  {
    id: "tool-poisoning",
    title: "Tool poisoning",
    severity: "high",
    asi: "ASI01 · Agent Goal Hijack",
    blurb:
      "Instructions smuggled into an MCP tool description. The model reads them as guidance and the human reviewing the PR never sees them.",
    image: "/landing/finding.svg",
  },
  {
    id: "unauth-mcp-transport",
    title: "Unauthenticated MCP transport",
    severity: "high",
    asi: "ASI02 · Tool Misuse",
    blurb:
      "A server exposes its tools over HTTP or SSE with no authentication in front. Anyone who can reach the port can drive your agent.",
    image: "/landing/transport.svg",
  },
  {
    id: "confused-deputy",
    title: "Confused deputy",
    severity: "high",
    asi: "ASI03 · Privilege Abuse",
    blurb:
      "The server forwards its own privileged credential onto a destination the caller controls, lending its authority to whoever asked.",
    image: "/landing/scope.svg",
  },
  {
    id: "cross-surface-scope-mismatch",
    title: "Cross-surface scope mismatch",
    severity: "high",
    asi: "ASI03 · Privilege Abuse",
    blurb:
      "Tool grants exceed the scopes the app was installed with. Only visible if you read the manifest and the tool definitions together.",
    image: "/landing/gate.svg",
  },
  {
    id: "over-permissioned-loop",
    title: "Over-permissioned agent loop",
    severity: "high",
    asi: "ASI08 · Cascading Failures",
    blurb:
      "An agent loop with no iteration cap and no budget. One bad tool result and it runs until something else stops it.",
    image: "/landing/repro.svg",
  },
  {
    id: "rls-gap",
    title: "Row-level security gap",
    severity: "high",
    asi: "ASI03 · Privilege Abuse",
    blurb: "A tenant table created without row-level security. Every agent query can read every tenant's rows.",
    image: "/landing/coverage.svg",
  },
  {
    id: "exposed-secret",
    title: "Exposed secret",
    severity: "critical",
    asi: "ASI04 · Supply Chain",
    blurb:
      "A live provider credential committed to source. Matched by issuer prefix, and only reported where it is genuinely reachable.",
    image: "/landing/cli.svg",
  },
  {
    id: "hbv",
    title: "Hallucination-based vulnerability",
    severity: "high",
    asi: "ASI01 · Goal Hijack / ASI09",
    blurb:
      "A tool that is vague about scope but broad in capability. The model fills the ambiguity with the most capable reading of it. Research tier.",
    image: "/landing/survey.svg",
  },
  {
    id: "missing-schema-validation",
    title: "Missing schema validation",
    severity: "medium",
    asi: "ASI02 · Tool Misuse",
    blurb:
      "A tool handler that accepts whatever the model produces. No shape check between the model's output and your execution path.",
    image: "/landing/determinism.svg",
  },
  {
    id: "unbounded-tool-param",
    title: "Unbounded tool parameter",
    severity: "medium",
    asi: "ASI02 · Tool Misuse",
    blurb:
      "A free-form string or array parameter with no enum, pattern, or length bound — the widest possible attack surface a tool can offer.",
    image: "/landing/bench.svg",
  },
  {
    id: "cors-misconfig",
    title: "CORS misconfiguration",
    severity: "high",
    asi: "General app security",
    blurb:
      "A wildcard origin, escalated when credentials are allowed alongside it. Common in AI-generated server scaffolding.",
    image: "/landing/transport.svg",
  },
  {
    id: "unpinned-dependency",
    title: "Unpinned dependency",
    severity: "high",
    asi: "ASI04 · Supply Chain",
    blurb:
      "A range that resolves to whatever was published last. On agent infrastructure that means your tool surface can change without a commit.",
    image: "/landing/coverage.svg",
  },
];

const SEV_CLASS: Record<Severity, string> = {
  critical: "gp-chip-critical",
  high: "gp-chip-high",
  medium: "gp-chip-medium",
};

export function DetectionSlider() {
  const rail = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    sync();
    const el = rail.current;
    if (!el) return;
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  const nudge = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth * 0.85 * dir, behavior: "smooth" });
  };

  return (
    <>
      <div className="gp-slider-nav">
        <button
          type="button"
          className="gp-arrow"
          onClick={() => nudge(-1)}
          disabled={atStart}
          aria-label="Previous detections"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          className="gp-arrow"
          onClick={() => nudge(1)}
          disabled={atEnd}
          aria-label="More detections"
        >
          <ArrowRight size={18} />
        </button>
      </div>

      <div className="gp-rail" ref={rail} tabIndex={0} role="region" aria-label="Vulnerability classes">
        {DETECTIONS.map((d, i) => (
          <Reveal key={d.id} delay={Math.min(i, 3)} className="gp-detect-wrap">
            <article className="gp-detect" aria-label={`${d.title} — ${d.severity} severity, ${d.asi}`}>
              <div className="gp-detect-media">
                <img src={d.image} alt="" className="gp-detect-img" loading="lazy" />
              </div>
              <div className="gp-detect-overlay" aria-hidden="true">
                <h3 className="gp-detect-title">{d.title}</h3>
                <div className="gp-detect-meta">
                  <span className={`gp-chip ${SEV_CLASS[d.severity]}`}>{d.severity}</span>
                  <span className="gp-detect-tag">{d.asi}</span>
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </>
  );
}
