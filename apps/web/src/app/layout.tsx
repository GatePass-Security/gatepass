import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OrgProvider } from "@/providers/OrgProvider";
import { Sidebar } from "@/components/Sidebar";
import { TopNavBar } from "@/components/TopNavBar";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gatepass — Precision AppSec",
  description: "Deterministic security scanning for AI-native and agentic codebases.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        {/*
          Resolve the theme before first paint. Dark is the product's canonical
          appearance (it is what the marketing site ships), so anything other
          than an explicit stored "light" resolves to dark — including a first
          visit on a light-preference OS.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.toggle('dark',localStorage.getItem('theme')!=='light');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="bg-canvas text-fg">
        <div className="gp-glow" aria-hidden="true" />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-action focus:px-4 focus:py-2 focus:text-[0.82rem] focus:font-medium focus:text-action-text"
        >
          Skip to content
        </a>
        <ToastProvider>
          <OrgProvider>
            <div className="relative z-10 flex min-h-screen">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopNavBar />
                <main id="main" className="flex-1 overflow-x-hidden">
                  <div className="mx-auto w-full max-w-[88rem] px-5 py-7 sm:px-7 lg:px-9">{children}</div>
                </main>
              </div>
            </div>
          </OrgProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
