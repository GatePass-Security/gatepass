import Link from "next/link";
import { AlertTriangle, ArrowLeft, Github, KeyRound, TerminalSquare } from "lucide-react";
import ApiClient from "@/lib/api-client";
import { API_BASE, apiUrlMisconfigured } from "@/lib/constants";
import { safeNextPath } from "@/lib/session-cookie";
import { BrandLockup } from "@/components/Brand";
import { InlineCode } from "@/components/ui/InlineCode";
import type { AuthConfig } from "@/lib/types";

/**
 * Sign in to Gatepass.
 *
 * A Server Component, because what it can offer depends on what the API is configured with,
 * and that answer belongs on the server. It asks `GET /v1/auth/config` and renders the doors
 * that actually exist — a deployment with no OAuth app gets the path that works rather than a
 * "Continue with GitHub" button that fails after a redirect.
 *
 * The development sign-in is shown only when the API says it is enabled, and it is labelled as
 * a development session in the interface itself rather than only in a comment. The guard is
 * server-side (`apps/api/src/auth.ts`): this page renders what it is told, and hiding the
 * button is presentation, not protection.
 */

export const dynamic = "force-dynamic";

/**
 * Long enough to outlast a suspended API waking up.
 *
 * This page server-renders, so it runs as a function with its own ceiling — and the platform
 * default is ten seconds, the same figure that made the client-side deadline too short. Raising
 * one without the other changes nothing: the fetch would still be alive when the function around
 * it was killed, and the visitor would still be told the API could not be reached.
 *
 * It costs nothing on a healthy request. A ceiling is not a delay; a warm config call still
 * answers in milliseconds.
 */
export const maxDuration = 60;

export const metadata = {
  title: "Sign in or create your account — Gatepass",
  // Nothing here should be indexed or previewed: it is a door, not a page.
  robots: { index: false, follow: false },
};

/**
 * Every failure the two OAuth route handlers can redirect back with.
 *
 * `detail` is what the person standing at the door reads. `operator` is what somebody with
 * access to the API service would have to change, and it is kept separate rather than tacked
 * onto the end of `detail`: a reader who cannot set an environment variable should not have to
 * work out that the second half of the sentence was not addressed to them.
 */
const ERRORS: Record<string, { title: string; detail: string; operator?: string }> = {
  cancelled: {
    title: "Sign-in cancelled",
    detail: "You chose not to authorize Gatepass on GitHub. Nothing was changed.",
  },
  state_mismatch: {
    title: "That sign-in could not be verified",
    detail:
      "The response from GitHub did not match the sign-in this browser started, so it was refused. This happens if the attempt was left open too long, or if the link was not one you clicked here. Starting again is safe.",
  },
  missing_code: {
    title: "GitHub did not return an authorization code",
    detail: "The redirect came back without the value needed to complete sign-in. Try again.",
  },
  exchange_failed: {
    title: "Couldn't complete sign-in",
    detail:
      "GitHub authorized the request, but the Gatepass API could not exchange it for a session. The API may be unreachable, or its OAuth credentials may not match the GitHub App.",
  },
  /*
   * GitHub said who you are and this deployment declined to open a session for you. Distinct
   * from `exchange_failed` on purpose: nothing went wrong, and telling someone to check the
   * API's credentials when the real answer is "you are not on the list" sends them to debug a
   * machine instead of asking a person for access.
   */
  not_admitted: {
    title: "Your GitHub account doesn't have access here",
    detail:
      "Sign-in worked — GitHub confirmed who you are — but Gatepass isn't installed on any GitHub organization your account can reach. Access here is exactly your GitHub access: ask an owner of your organization to install the Gatepass App, or to give you collaborator access to a repository it already covers.",
  },
  /*
   * One message for "no such account" and for "wrong password", because the API returns one
   * answer for both. A form that distinguishes them tells an attacker which usernames are real,
   * which is the first thing worth knowing before attacking one.
   */
  bad_credentials: {
    title: "That username and password didn't match",
    detail: "Check both and try again. If you were given these credentials by someone, ask them to confirm.",
  },
  too_many_attempts: {
    title: "Too many failed attempts",
    detail:
      "Sign-in is paused for this account and this network for a few minutes. This is a rate limit, not a lockout — nothing has been disabled, and it clears on its own.",
  },
  password_unavailable: {
    title: "Password sign-in isn't enabled here",
    detail: "This deployment has no local accounts, so there is no password to check. Sign in with GitHub instead.",
    operator: "Set GATEPASS_LOCAL_USERS on the API service to enable local accounts.",
  },
  session_expired: {
    title: "Your session ended while you were on GitHub",
    detail: "Nothing was changed. Sign in again, then connect your GitHub account from the dashboard.",
  },
  github_unavailable: {
    title: "GitHub sign-in isn't available",
    detail:
      "Gatepass could not start a GitHub sign-in — either this deployment has no GitHub credentials set up, or the server did not respond. Nothing you did caused this.",
    operator:
      "Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET and SESSION_SECRET on the API service, and check the API is reachable.",
  },
  dev_unavailable: {
    title: "The development sign-in is not enabled",
    detail: "The server refused it. This door only exists on a development machine, never in production.",
    operator:
      "It requires GATEPASS_DEV_AUTH=1 and a non-production NODE_ENV — run the API with `pnpm --filter @gatepass/api dev`.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next ?? null);
  const failure = params.error ? ERRORS[params.error] : undefined;

  // Null means the API did not answer. Rendered below as its own state rather than as an empty
  // page — "no sign-in options" and "cannot reach the service" are different problems, and a
  // person staring at a login screen deserves to know which one they have.
  const config: AuthConfig | null = await new ApiClient(API_BASE).authConfig().catch(() => null);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <Link href="/" className="mb-8 inline-flex w-fit rounded-[0.5rem]" aria-label="Gatepass — home">
        <BrandLockup size={30} subtitle="Precision AppSec" />
      </Link>

      {/*
        "Sign in" alone was wrong for half the people who arrive here: the landing page's primary
        call to action is "Start scanning — free", and it lands on this page. Someone who has never
        used Gatepass read a sign-in heading, looked for a create-account link, and found none —
        not because it was hidden, but because signing in with GitHub *is* the sign-up.
      */}
      <h1 className="text-[1.6rem] font-medium tracking-[-0.03em] text-fg">Sign in or create your account</h1>
      <p className="mt-2 text-[0.855rem] leading-relaxed text-fg-secondary">
        Gatepass reads your repositories through its GitHub App. The same button does both — it identifies you, and on a
        first visit it creates the workspace for the organization whose findings you can see.
      </p>

      {failure && (
        <div
          role="alert"
          className="mt-6 rounded-[var(--radius-card)] border border-critical-line bg-critical-soft p-4"
        >
          <p className="flex items-center gap-2 text-[0.855rem] font-medium text-critical">
            <AlertTriangle size={15} aria-hidden="true" />
            {failure.title}
          </p>
          <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-secondary">{failure.detail}</p>
          {failure.operator && (
            <p className="mt-2.5 border-l-2 border-line pl-3 text-[0.72rem] leading-relaxed text-fg-muted">
              <span className="font-medium text-fg-secondary">For whoever runs this deployment</span> —{" "}
              <InlineCode text={failure.operator} />
            </p>
          )}
        </div>
      )}

      {config === null ? (
        <div className="mt-7 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          {apiUrlMisconfigured() ? (
            /* Addressed to whoever deployed this, because only they can fix it. Telling a visitor
               to start a server on loopback asks them to run software they do not have. */
            <>
              <p className="text-[0.855rem] font-medium text-fg">Sign-in isn&rsquo;t configured on this deployment</p>
              <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-secondary">
                This deployment points at <span className="font-mono text-fg-muted">{API_BASE}</span> — the default used
                for local development — so it is asking its own machine for the API rather than a server. No API URL was
                set.
              </p>
              <p className="mt-2.5 text-[0.78rem] leading-relaxed text-fg-secondary">
                If this is your deployment: set <span className="font-mono text-fg-muted">GATEPASS_API_URL</span> to the
                API&rsquo;s origin and redeploy. It is read at runtime, so it does not have to be present when the
                bundle is built.
              </p>
            </>
          ) : (
            <>
              <p className="text-[0.855rem] font-medium text-fg">Can&rsquo;t reach the Gatepass API</p>
              <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-secondary">
                No response from <span className="font-mono text-fg-muted">{API_BASE}</span>, so this page cannot tell
                which sign-in methods are available. Start the API and reload.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-7 space-y-4">
          {config.github && (
            <div>
              {/*
                One door for both, because there is only one door.
                Gatepass has no separate sign-up: installing the GitHub App on an organization is
                what creates the tenant, and the first person to sign in from that installation
                brings it into being (`handlers.ts` → `ensureOrgFor`). A button reading only
                "Continue with GitHub" told a first-time visitor nothing about that, so people
                arriving from "Start scanning — free" looked for a create-account link that does
                not exist and cannot exist without inventing identities GitHub does not recognise.
              */}
              <a
                href={`/api/auth/github/start?next=${encodeURIComponent(next)}`}
                className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-action px-5 text-[0.9rem] font-medium text-action-text transition-colors duration-150 hover:bg-action-hover"
              >
                <Github size={16} aria-hidden="true" />
                Sign up or sign in with GitHub
              </a>
              <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
                First time here? This creates your account. Your workspace is the GitHub organization you install the
                Gatepass App on, and what you can see in it is exactly what GitHub already lets you see — there is
                nothing separate to set up, and no access list for us to get wrong.
              </p>
            </div>
          )}

          {config.password && <PasswordSignIn next={next} showDivider={config.github} />}

          {config.devAuth && <DevSignIn next={next} showDivider={config.github || Boolean(config.password)} />}

          {!config.github && !config.devAuth && !config.password && <NoSignInConfigured />}
        </div>
      )}

      <Link
        href="/"
        className="mt-9 inline-flex w-fit cursor-pointer items-center gap-1.5 text-[0.78rem] text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        Back to gatepass.dev
      </Link>
    </main>
  );
}

/**
 * The local account door: a username and password, no GitHub involved.
 *
 * Deliberately below "Continue with GitHub" rather than above it. GitHub is how the product
 * actually works — it is what decides which repositories somebody sees — and a password account
 * is the exception for people who need to look at a deployment before, or without, connecting
 * an account. Ordering the page the other way around would suggest the exception is the norm.
 *
 * The fields are a plain `POST` form to a Route Handler, so the password is submitted by the
 * browser and never touched by client JavaScript. `autoComplete` is named properly so password
 * managers offer to store it — the alternative is people keeping it somewhere worse.
 */
function PasswordSignIn({ next, showDivider }: { next: string; showDivider: boolean }) {
  return (
    <>
      {showDivider && (
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[0.7rem] tracking-[0.06em] text-fg-muted uppercase">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <form method="POST" action="/api/auth/password" className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="login" className="mb-1.5 block text-[0.78rem] font-medium text-fg-secondary">
            Username
          </label>
          <input
            id="login"
            name="login"
            type="text"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-sunken px-3.5 text-[0.855rem] text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong focus-visible:border-accent focus-visible:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[0.78rem] font-medium text-fg-secondary">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-sunken px-3.5 text-[0.855rem] text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong focus-visible:border-accent focus-visible:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-[0.9rem] font-medium text-fg transition-colors duration-150 hover:bg-raised"
        >
          <KeyRound size={15} aria-hidden="true" />
          Sign in
        </button>
      </form>
    </>
  );
}

/**
 * The local development door.
 *
 * Labelled plainly, in the interface, as what it is: no GitHub, no verification, admin rights,
 * and it expires in hours. The alternative — a quiet "dev login" button that looks like the
 * real one — is how a development affordance ends up somewhere it should not be.
 */
function DevSignIn({ next, showDivider }: { next: string; showDivider: boolean }) {
  return (
    <>
      {showDivider && (
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[0.7rem] tracking-[0.06em] text-fg-muted uppercase">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <form
        method="POST"
        action="/api/auth/dev"
        className="rounded-[var(--radius-card)] border border-medium-line bg-medium-soft p-5"
      >
        <p className="flex items-center gap-2 text-[0.82rem] font-medium text-medium">
          <TerminalSquare size={15} aria-hidden="true" />
          Development session
        </p>
        <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-secondary">
          This machine is running with <span className="font-mono text-fg-muted">GATEPASS_DEV_AUTH=1</span>. It signs
          you in as an <strong className="font-medium text-fg">admin</strong> without contacting GitHub and without
          verifying who you are, and the session expires in 12 hours. The API refuses this entirely when{" "}
          <span className="font-mono text-fg-muted">NODE_ENV=production</span>.
        </p>

        <input type="hidden" name="next" value={next} />
        <div className="mt-4">
          <label htmlFor="dev-login" className="mb-1.5 block text-[0.78rem] font-medium text-fg-secondary">
            Display name
          </label>
          <input
            id="dev-login"
            name="login"
            defaultValue="dev"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="dev-login-hint"
            className="h-10 w-full rounded-[0.6rem] border border-line bg-sunken px-3 text-[0.855rem] text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong"
          />
          <p id="dev-login-hint" className="mt-1.5 text-[0.72rem] text-fg-muted">
            Shown in the top bar so it is obvious which session you are in. Letters, digits, dot, dash, underscore.
          </p>
        </div>

        <button
          type="submit"
          className="mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.855rem] font-medium text-fg transition-colors duration-150 hover:bg-raised"
        >
          <KeyRound size={15} aria-hidden="true" />
          Continue as a development user
        </button>
      </form>
    </>
  );
}

/** Neither door is open. Say exactly what to set rather than showing a dead button. */
function NoSignInConfigured() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <p className="text-[0.855rem] font-medium text-fg">There is no way to sign in here yet</p>
      <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-secondary">
        This deployment has no sign-in method turned on — no GitHub, no password, no development session — so nobody can
        start a session on it. This is a setup step nobody has done, not a problem with your account.
      </p>
      <dl className="mt-4 space-y-3 text-[0.78rem]">
        <div>
          <dt className="font-medium text-fg">For a real deployment</dt>
          <dd className="mt-1 leading-relaxed text-fg-secondary">
            Set <span className="font-mono text-fg-muted">GITHUB_OAUTH_CLIENT_ID</span>,{" "}
            <span className="font-mono text-fg-muted">GITHUB_OAUTH_CLIENT_SECRET</span> and{" "}
            <span className="font-mono text-fg-muted">SESSION_SECRET</span> on the API service and restart it.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-fg">To work on this locally</dt>
          <dd className="mt-1 leading-relaxed text-fg-secondary">
            Run the API with <span className="font-mono text-fg-muted">pnpm --filter @gatepass/api dev</span>, which
            turns on the development sign-in. It cannot be turned on when{" "}
            <span className="font-mono text-fg-muted">NODE_ENV=production</span>.
          </dd>
        </div>
      </dl>
    </div>
  );
}
