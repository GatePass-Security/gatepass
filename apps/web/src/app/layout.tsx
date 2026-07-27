import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

/** Marketing surface only. The product UI keeps Plus Jakarta Sans. */
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-tight",
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
    "Gatepass catches the vulnerability classes that appear when AI writes the code and agents run it — tool poisoning, confused deputy, unauthenticated MCP transports — and blocks them in the pull request. Deterministic, ~1ms, zero tokens.",
  openGraph: {
    title: "Gatepass — Deterministic security for AI-native code",
    description:
      "12/12 agentic vulnerability classes detected where Semgrep finds 1 and Trivy finds 0. Byte-identical across runs. No LLM in the loop.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jakarta.variable} ${jetbrains.variable} ${interTight.variable}`}
    >
      <head>
        {/* Apply saved theme before first paint so dark mode never flashes light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-page">{children}</body>
    </html>
  );
}
