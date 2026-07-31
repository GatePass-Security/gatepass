"use client";

import "./globals.css";

/**
 * The last boundary. It only runs when the root layout itself failed, which means nothing above
 * it exists — so this file has to supply its own `<html>` and `<body>`.
 *
 * Everything here is deliberately self-contained. Shared components, the theme script, the
 * webfonts and the design tokens all live in or below the layout that just failed, and reaching
 * for any of them is how a fallback ends up throwing inside the handler for a throw. The
 * stylesheet is imported because Next requires the class names to resolve for the page to look
 * like anything at all, but the colours below are literal so the page is legible even if the
 * cascade never arrives.
 *
 * This is close to unreachable in practice. That is exactly why it says something a person can
 * read instead of leaving them on Next's stock screen when it does happen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0a0b0d",
          color: "#e7e9ea",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem" }} role="alert">
          <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 500, letterSpacing: "-0.02em" }}>
            Gatepass couldn’t start
          </h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", lineHeight: 1.6, color: "#a3a8ad" }}>
            The dashboard failed before it could draw anything. This is a fault on our side — nothing you did caused it,
            and nothing was saved or lost as a result.
          </p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", lineHeight: 1.6, color: "#a3a8ad" }}>
            Try again. If it keeps happening, send whoever runs your Gatepass deployment the reference below.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              cursor: "pointer",
              borderRadius: "999px",
              border: "none",
              background: "#e7e9ea",
              color: "#0a0b0d",
              padding: "0.625rem 1.1rem",
              fontSize: "0.855rem",
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.72rem", color: "#6b7075", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
