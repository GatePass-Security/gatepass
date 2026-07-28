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
      {/*
        Wordmark. The mark used to be a mint-gradient chip with a tick in it,
        which is not the logo this site ships — the real one is a flat mint
        shield with no container behind it, so that is what a share preview
        should carry.
      */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width={56} height={56} viewBox="0 0 32 32" fill="none">
          <path
            d="M16 3.2 L27.4 7.6 V15.8 C27.4 22.4 22.6 27.4 16 29.8 C9.4 27.4 4.6 22.4 4.6 15.8 V7.6 Z"
            stroke="#2dd4bf"
            strokeWidth={2.6}
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M16 13.6 H21.6 C21.6 18.4 19.2 21.4 16 23.2 C12.8 21.4 10.4 18.4 10.4 13.6"
            stroke="#2dd4bf"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
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
