import { headers } from "next/headers";
import { API_BASE } from "@/lib/constants";
import { PATHNAME_HEADER } from "@/lib/session-cookie";
import { requireSession, SessionUnavailableError } from "@/lib/session";
import type { Role, SessionInfo } from "@/lib/types";
import { OrgProvider } from "@/providers/OrgProvider";
import { SessionProvider, type SessionUser } from "@/providers/SessionProvider";
import { Sidebar } from "@/components/Sidebar";
import { TopNavBar } from "@/components/TopNavBar";
import { ToastProvider } from "@/components/ui/Toast";
import { DemoProvider } from "@/components/demo/DemoProvider";

/**
 * The API did not answer, so we cannot tell whether this session is still good.
 *
 * A page rather than a redirect, deliberately. The user's cookie is untouched and probably
 * fine; reloading once the API is back signs them straight in. Redirecting to `/login` would
 * both throw away a working session and re-enter the redirect loop, since the middleware
 * accepts the cookie the API could not be asked about.
 */
function ApiUnreachable({ detail }: { detail: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6">
      <h1 className="text-[1.05rem] font-medium text-fg">Can&rsquo;t reach the Gatepass API</h1>
      <p className="mt-2 text-[0.82rem] leading-relaxed text-fg-secondary">
        No response from <span className="font-mono text-fg-muted">{API_BASE}</span>, so the dashboard cannot confirm
        your session. You are still signed in — start the API and reload this page.
      </p>
      <p className="mt-3 font-mono text-[0.72rem] text-fg-muted">{detail}</p>
    </main>
  );
}

/**
 * Chrome for the authenticated product. Lives here rather than in the root layout so the
 * marketing landing page at `/` and the login page render without a sidebar wrapped around
 * them.
 *
 * It is also where the session actually gets verified. `middleware.ts` turns away requests
 * carrying no cookie, but it only reads the token's claims — the signing key is in the API
 * process. `requireSession()` asks `GET /v1/auth/me`, so a forged, tampered, revoked or
 * stale-secret cookie is refused here, once, for every route in the product rather than being
 * something each page has to remember.
 *
 * Rendering the shell on the server also means the org reaches the client as a prop from a
 * verified session instead of the `"demo"` literal that used to be compiled into the bundle.
 *
 * There is no ambient glow behind this shell. A radial mint wash used to sit under the header
 * — on the landing page that same effect belongs to a hero and has a job, but over a working
 * surface it was decoration that tinted the top of every table and made severity colours read
 * differently at the top of a page than at the bottom.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Set by `middleware.ts` — Next does not hand a layout its own pathname. It is what lets the
  // sign-in redirect return the user to the page they asked for rather than the overview.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? undefined;

  /*
   * Two failures, two answers.
   *
   * A *refused* session redirects, and `requireSession` routes that through the handler that
   * can actually clear the cookie. An *unaskable* one must not redirect at all: the cookie is
   * probably fine, the middleware still accepts it, and sending the user to `/login` while they
   * hold it is the loop this whole path exists to break. So it renders instead — the session
   * survives the outage, and reloading once the API is back costs nothing.
   *
   * The rethrow matters: `redirect()` works by throwing, so swallowing everything here would
   * turn every sign-in redirect in the product into this page.
   */
  let session: SessionInfo;
  try {
    session = await requireSession(pathname);
  } catch (err) {
    if (err instanceof SessionUnavailableError) return <ApiUnreachable detail={err.message} />;
    throw err;
  }

  const user: SessionUser = {
    userId: String(session.userId),
    login: String(session.login ?? session.userId),
    orgId: session.orgId,
    role: session.role as Role,
    // Every org this GitHub account reaches, straight from the same verified `/v1/auth/me`
    // call — so the switcher costs no extra round-trip and cannot disagree with the session
    // it sits next to. Absent on a deployment that does not derive access from GitHub.
    ...(session.orgs ? { orgs: session.orgs } : {}),
    // A dev session's user id is minted by the API as `dev:<login>`; nothing else produces
    // that prefix, and the banner it drives has to be impossible to miss.
    development: String(session.userId).startsWith("dev:"),
    // A local password account is `local:<login>` — a normal way to be signed in, not a
    // warning, and what the "connect GitHub" affordance keys off.
    local: String(session.userId).startsWith("local:"),
  };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-action focus:px-4 focus:py-2 focus:text-[0.82rem] focus:font-medium focus:text-action-text"
      >
        Skip to content
      </a>
      {/*
        `SessionProvider` is outermost of the client providers because everything below it reads
        the session: `OrgProvider` derives the active org from it, the tour asks it which tenant to
        drive, and `TopNavBar` renders who you are signed in as. It is the verified session from
        `requireSession()` above, handed down as a prop — no page re-fetches it, and none of them
        can disagree about who is signed in.
      */}
      <SessionProvider session={user}>
        <ToastProvider>
          <OrgProvider>
            <DemoProvider>
              <div className="relative z-10 flex min-h-screen">
                <Sidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                  <TopNavBar />
                  <main id="main" className="flex-1 overflow-x-hidden">
                    <div className="mx-auto w-full max-w-[88rem] px-5 py-7 sm:px-7 lg:px-9">{children}</div>
                  </main>
                </div>
              </div>
            </DemoProvider>
          </OrgProvider>
        </ToastProvider>
      </SessionProvider>
    </>
  );
}
