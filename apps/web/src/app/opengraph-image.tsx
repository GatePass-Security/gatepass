import { ImageResponse } from "next/og";

/**
 * Open Graph image — Next.js file convention.
 *
 * Renders a branded 1200×630 card via Satori (`next/og`) at request time and auto-injects
 * `og:image` / `twitter:image` into the document head. No static asset to maintain; the
 * copy mirrors the landing hero so previews and the page stay in sync.
 */

export const runtime = "nodejs";
export const alt = "Gatepass — Deterministic security for AI-native code";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATS: Array<[string, string]> = [
  ["12/12", "agentic classes"],
  ["0%", "false positives"],
  ["0.9 ms", "per scan"],
  ["×10", "byte-identical"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 1200,
        height: 630,
        backgroundColor: "#020202",
        backgroundImage: "radial-gradient(ellipse 62% 52% at 50% 0%, rgba(45,212,191,0.20), transparent 60%)",
        padding: 80,
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(150deg, #2dd4bf, #0f766e)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width={30}
            height={30}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#04201d"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <span style={{ fontSize: 34, fontWeight: 600, color: "#ffffff", letterSpacing: -1 }}>Gatepass</span>
      </div>

      {/* Two-tone headline, mirroring the landing hero */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 64 }}>
        <span style={{ fontSize: 72, fontWeight: 600, color: "#8f8f96", lineHeight: 1.1, letterSpacing: -2 }}>
          AI writes the code.
        </span>
        <span style={{ fontSize: 72, fontWeight: 600, color: "#ffffff", lineHeight: 1.1, letterSpacing: -2 }}>
          Gatepass decides if it ships.
        </span>
      </div>

      {/* Sub */}
      <div style={{ display: "flex", marginTop: 32, maxWidth: 940 }}>
        <span style={{ fontSize: 30, color: "#c0c0c0", lineHeight: 1.4 }}>
          Deterministic security for AI-native and agentic codebases — tool poisoning, confused deputies,
          unauthenticated MCP transports. Same bytes, every run. No model in the loop.
        </span>
      </div>

      {/* Proof strip pinned to the bottom */}
      <div style={{ display: "flex", marginTop: "auto", gap: 56 }}>
        {STATS.map(([value, label]) => (
          <div key={value} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 40, fontWeight: 600, color: "#2dd4bf" }}>{value}</span>
            <span style={{ fontSize: 20, color: "#7e7e86", marginTop: 6 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>,
    { ...size },
  );
}
