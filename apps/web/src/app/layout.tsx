import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
 * One typeface across both surfaces. Inter Tight is what the marketing site is
 * set in, and the dashboard is the same product — an earlier revision of the
 * dashboard guessed at a match (Geist) because the landing page did not yet
 * live in this repo. Plus Jakarta Sans is gone: nothing references it now that
 * the product UI uses the same face as the marketing surface.
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-tight",
  display: "swap",
});

/** Code and figures, on both surfaces. */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Resolves og:image / twitter:image URLs against the deployed origin. The protocol guard keeps
// a malformed NEXT_PUBLIC_SITE_URL (e.g. "gatepass.dev" without a scheme) from throwing inside
// `new URL()` and crashing the root layout for every route. Override locally with
// NEXT_PUBLIC_SITE_URL=http://localhost:3001 so dev previews emit absolute image URLs.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL && /^https?:\/\//.test(process.env.NEXT_PUBLIC_SITE_URL)
    ? process.env.NEXT_PUBLIC_SITE_URL
    : "https://gatepass.dev";

export const metadata: Metadata = {
  // `metadataBase` requires a URL instance (not a string) in this Next type definition; the
  // guard above ensures `new URL()` only ever sees a well-formed http(s):// value.
  metadataBase: new URL(siteUrl),
  title: "Gatepass — Deterministic security for AI-native code",
  description:
    "Gatepass catches the vulnerability classes that appear when AI writes the code and agents run it — tool poisoning, confused deputy, unauthenticated MCP transports — and blocks them in the pull request. Deterministic, ~1ms, with a runnable reproduction on every verified finding.",
  openGraph: {
    title: "Gatepass — Deterministic security for AI-native code",
    description:
      "12/12 agentic vulnerability classes detected where Semgrep finds 1 and Trivy finds 0. Byte-identical across runs. No LLM in the loop.",
    type: "website",
  },
};

/*
 * The root layout carries no product chrome. `/` is the marketing landing page
 * and must render without a sidebar around it; the authenticated shell lives in
 * `(app)/layout.tsx` instead.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${interTight.variable} ${jetbrains.variable}`}>
      <head>
        {/*
          Resolve the theme before first paint. Dark is the product's canonical
          appearance — it is what the marketing surface ships, and that surface
          is dark unconditionally — so anything other than an explicit stored
          "light" resolves to dark, including a first visit on a light-preference
          OS.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.toggle('dark',localStorage.getItem('theme')!=='light');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="bg-canvas text-fg">{children}</body>
    </html>
  );
}
