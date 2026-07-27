import { OrgProvider } from "@/providers/OrgProvider";
import { Sidebar } from "@/components/Sidebar";
import { TopNavBar } from "@/components/TopNavBar";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * Chrome for the authenticated product. Lives here rather than in the root
 * layout so the marketing landing page at `/` renders without a sidebar wrapped
 * around it.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
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
    </>
  );
}
