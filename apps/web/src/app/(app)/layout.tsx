import { OrgProvider } from "@/providers/OrgProvider";
import { Sidebar } from "@/components/Sidebar";
import { TopNavBar } from "@/components/TopNavBar";

/**
 * Chrome for the authenticated product. Lives here rather than in the root layout so the
 * marketing landing page at `/` can render without a sidebar wrapped around it.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OrgProvider>
      <div className="flex min-h-screen bg-page antialiased">
        <Sidebar />
        <div className="flex flex-1 flex-col md:ml-0">
          <TopNavBar />
          <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </OrgProvider>
  );
}
