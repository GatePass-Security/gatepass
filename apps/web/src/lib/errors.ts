import { API_BASE, API_BASE_CONFIGURED } from "./constants";
import { ApiError } from "./types";

/**
 * One place that turns anything thrown into something a person can act on.
 *
 * Before this existed, 21 call sites did `err instanceof Error ? err.message : "…"`
 * and put the result on screen. That meant users read the API's internal strings
 * verbatim — a missing org rendered as the two words **"org nope"**, a bad scan
 * path as `ENOENT: no such file or directory, scandir '/x'`, and a missing GitHub
 * App as `no repo fetcher configured (set options.repoFetcher)`, which names a
 * TypeScript option nobody outside this repo can set.
 *
 * Every mapping below is keyed off a message this API genuinely produces
 * (verified against a running server), not off a guess about what it might say.
 * Anything unrecognised still degrades to a usable message, and the original
 * string is preserved in `technical` so it can be shown as secondary detail
 * rather than as the headline.
 */

export type ErrorKind =
  "offline" | "timeout" | "notFound" | "denied" | "unconfigured" | "invalid" | "rateLimited" | "server" | "unknown";

export interface FriendlyError {
  kind: ErrorKind;
  /** Headline. Sentence case, no trailing period — it renders as a title. */
  title: string;
  /** What happened, in the reader's terms. One or two sentences. */
  detail: string;
  /**
   * The next thing *this reader* can do, with what they already have. Omitted when there
   * genuinely isn't one — an empty suggestion is worse than none.
   */
  action?: string;
  /**
   * The next thing whoever runs the deployment would do: environment variables, restarts,
   * credentials. Separate from `action` because most people reading a Gatepass error cannot
   * set an environment variable on the API service, and telling them to is a dead end that
   * looks like an instruction. Rendered demoted, below the part they can act on.
   */
  operator?: string;
  /** HTTP status, when there was one. */
  status?: number;
  /** The original message. Secondary detail for a bug report — never the headline. */
  technical?: string;
  /** Whether retrying the same request could plausibly succeed. */
  retryable: boolean;
}

/** Context lets a generic status map to a specific sentence. */
export interface ErrorContext {
  /** What the user was looking at: "scan", "findings", "the fleet". */
  subject?: string;
  /** What they were trying to do: "run this scan", "export evidence". */
  action?: string;
}

/** Fetch rejects with a TypeError when the host is unreachable; the text varies by browser. */
function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /fetch|network|load failed|connection/i.test(err.message);
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "";
}

/**
 * Whether the API this dashboard points at lives on the reader's own machine.
 *
 * It decides which half of "the API is down" is useful to say. On localhost the reader is
 * almost certainly the person who can start it, so naming the command is the whole answer. On
 * a hosted deployment they almost certainly cannot, and "start the API" reads as an instruction
 * they are failing to follow rather than as information.
 */
function isLocalApi(base: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(base);
}

/**
 * The API did not answer at all.
 *
 * One builder, because this is reachable two ways — a browser `TypeError` on a direct call,
 * and a 502 from the same-origin proxy when it cannot reach upstream — and which path the
 * request took is not something the reader should be able to feel.
 */
export function offlineError(base: string): Omit<FriendlyError, "technical" | "status"> {
  return {
    kind: "offline",
    title: "Gatepass can’t reach its server",
    detail:
      "The dashboard loaded, but the Gatepass server did not answer. It may still be starting up, or it may be briefly down. Nothing you were doing was lost.",
    action: "Wait a few seconds, then try again.",
    operator: operatorNote(base),
    retryable: true,
  };
}

/**
 * The same outage as seen from the browser, where the unreachable host is this page's origin.
 *
 * Deliberately names no address. The one the client bundle could see is the API's, and the API
 * is not what the browser was calling.
 */
function browserOfflineError(): Omit<FriendlyError, "technical" | "status"> {
  return {
    kind: "offline",
    title: "Gatepass can’t reach its server",
    detail:
      "The request did not leave this page — the connection dropped, or the dashboard itself is unreachable. Nothing you were doing was lost.",
    action: "Check your connection, then try again.",
    operator: "The browser could not reach the dashboard's own origin, so this is a network or hosting fault here.",
    retryable: true,
  };
}

/**
 * What to tell whoever runs this deployment, which depends on *why* the address is what it is.
 *
 * The case worth separating is the third one. A hosted dashboard with no API URL configured
 * falls back to localhost and then reports that nothing is listening there — true, useless, and
 * pointed at the wrong machine entirely. Left as "start the API on this machine", it sends an
 * operator to debug a local process on a server they are not looking at, when the actual fix is
 * one environment variable. The dashboard knows which of these it is, so it should say.
 */
function operatorNote(base: string): string {
  if (!API_BASE_CONFIGURED && base === API_BASE) {
    return (
      `No API URL is configured for this dashboard, so it fell back to ${base} — its own loopback, ` +
      `where nothing is listening. Set GATEPASS_API_URL to the API's public origin ` +
      `(for example https://gatepass-api.onrender.com) on the dashboard's host and redeploy.`
    );
  }
  return isLocalApi(base)
    ? `The dashboard is pointed at ${base}, and nothing is listening there. If you are running Gatepass on this machine, start the API with \`pnpm --filter @gatepass/api dev\` and reload.`
    : `The dashboard is pointed at ${base} and got no response. Check that the API service is running and reachable from the dashboard's network.`;
}

/**
 * `NotFoundError` stringifies as `"<resource> <identifier>"` — literally
 * `org nope`, `scan 0000…`, `fleet server abc`. Recover the resource word so the
 * message can name the thing rather than echoing a fragment.
 */
function namedResource(message: string): string | undefined {
  const match = /^(org|scan|finding|fleet server|benchmark|compliance scan)\s+\S+$/.exec(message.trim());
  return match?.[1];
}

const RESOURCE_LABEL: Record<string, string> = {
  org: "organization",
  scan: "scan",
  finding: "finding",
  "fleet server": "MCP server",
  benchmark: "benchmark",
  "compliance scan": "compliance scan",
};

/**
 * Message-pattern rules, checked before the status-code fallback because a
 * specific cause always beats a generic one. Order matters: first match wins.
 */
const PATTERNS: Array<{
  test: RegExp;
  build: (m: RegExpExecArray, ctx: ErrorContext) => Omit<FriendlyError, "technical" | "status">;
}> = [
  {
    // The most common one in a fresh deployment, and the reason this file exists.
    test: /no repo fetcher configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "Cloning from GitHub isn't set up on this deployment",
      detail:
        "To clone a repository, the API has to authenticate as the Gatepass GitHub App, and this server has no App credentials. Nothing is broken — the feature just isn't configured yet.",
      action: "Scan a directory the API can already read using the “Path on host” option, which needs no setup.",
      operator:
        "To enable cloning, set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_INSTALLATION_ID on the API service and restart it.",
      retryable: false,
    }),
  },
  {
    /*
     * Anonymous fetching is public-only, and GitHub answers 404 for a private repository just
     * as it does for one that does not exist — deliberately, so that anonymous callers cannot
     * enumerate private repos by their error codes. Rendering that as a bare "not found" sends
     * people to check their spelling when the actual answer is "we have not been let in".
     */
    test: /([\w.-]+\/[\w.-]+) was not found\. Anonymous access can only reach public repositories/i,
    build: (m) => ({
      kind: "invalid",
      title: `Gatepass couldn't reach ${m[1]}`,
      detail:
        "Without GitHub App credentials the API fetches anonymously, and GitHub gives an anonymous caller the same answer for a private repository as for one that doesn't exist. So this is either a typo or a repository Gatepass has not been granted access to.",
      action: "Check the owner and name for a typo, if it is a public repository.",
      operator:
        "To scan private repositories, install the Gatepass GitHub App and set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_INSTALLATION_ID on the API service.",
      retryable: false,
    }),
  },
  {
    // Exhaustion arrives as 403, which reads as a permissions problem and sends people looking
    // in the wrong place entirely. It is a quota, and it refills.
    test: /anonymous rate limit is exhausted/i,
    build: () => ({
      kind: "unconfigured",
      title: "GitHub's anonymous request limit is used up",
      detail:
        "This deployment fetches repositories without credentials, which GitHub caps at 60 requests an hour per IP address. The limit refills on its own — nothing is broken and nothing was rejected on its merits.",
      action: "Wait for the hour to roll over, then try again.",
      operator:
        "Configuring the Gatepass GitHub App (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID) raises the limit to 5,000 an hour and unlocks private repositories.",
      retryable: true,
    }),
  },
  {
    test: /([\w.-]+\/[\w.-]+) is not visible to this Gatepass installation/i,
    build: (m) => ({
      kind: "denied",
      title: `${m[1]} isn't shared with Gatepass`,
      detail:
        "The API authenticated as the Gatepass GitHub App, and GitHub does not list that repository among the ones the App was installed on.",
      action:
        "Add the repository to the Gatepass App's installation on GitHub (Settings → Applications → Gatepass → Configure), or check the owner/name spelling.",
      retryable: false,
    }),
  },
  {
    // Raw Node fs error from a local-path scan. Recover the path it was given.
    test: /ENOENT.*?['"](.+?)['"]|ENOENT: no such file or directory/i,
    build: (m) => ({
      kind: "invalid",
      title: "That path doesn't exist on the API host",
      detail: m[1]
        ? `The API looked for ${m[1]} and found nothing there. This path is resolved on the machine running the API, not on your computer.`
        : "The API could not find that directory. The path is resolved on the machine running the API, not on your computer.",
      action: "Check the path exists on the API host and that the API process can read it.",
      retryable: false,
    }),
  },
  {
    test: /EACCES|permission denied/i,
    build: () => ({
      kind: "denied",
      title: "The API can't read that path",
      detail: "The directory exists, but the operating system refused the API process access to it.",
      action: "Grant the API's user read access to that directory, or choose a path it already owns.",
      retryable: false,
    }),
  },
  {
    // The fix-PR equivalent of "no repo fetcher configured": opening a PR needs a GitHub App
    // with contents:write, and most deployments have no App at all.
    test: /fix pull requests are not configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "Opening pull requests isn't set up on this deployment",
      detail:
        "To open a fix pull request, the API has to authenticate as the Gatepass GitHub App with write access to the branch it creates, and this server has no App credentials. Nothing is broken — the feature just isn't configured yet.",
      action:
        "The guidance on each finding is complete on its own — you can apply it by hand, or hand it to your coding agent.",
      operator:
        "To enable pull requests, install the Gatepass GitHub App with contents:write and set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_INSTALLATION_ID on the API service.",
      retryable: false,
    }),
  },
  {
    test: /fix pull requests are not enabled for this org/i,
    build: () => ({
      kind: "denied",
      title: "Fix pull requests are turned off for this organization",
      detail:
        "Writing to a repository is off by default. Gatepass only ever opens a pull request on a new branch, when a person asks for it — but the organization still has to opt in first.",
      action: "Turn on “Fix pull requests” in Settings, then try again.",
      retryable: false,
    }),
  },
  {
    test: /branch "(.+?)" already exists/i,
    build: (m) => ({
      kind: "invalid",
      title: "That fix branch already exists",
      detail: `“${m[1]}” is already on the remote. Gatepass never force-pushes over a branch it did not just create, so it stopped rather than overwriting whatever is there.`,
      action: "Merge or delete that branch, or re-scan the repository to get a fresh one.",
      retryable: false,
    }),
  },
  {
    test: /no findings in this scan carry an applicable fix/i,
    build: () => ({
      kind: "invalid",
      title: "Nothing in this scan can be committed as a fix",
      detail:
        "Every finding here is guidance-only. Those fixes need a value a person has to choose — an allow-listed origin, a version to pin, an RLS policy predicate — and Gatepass will not commit a placeholder that looks like a decision.",
      action: "Open a finding to read its guidance and apply it yourself.",
      retryable: false,
    }),
  },
  {
    test: /not associated with a GitHub repository/i,
    build: () => ({
      kind: "invalid",
      title: "This scan has no GitHub repository behind it",
      detail:
        "It scanned a directory on the API host, which has no remote, so there is nowhere to open a pull request.",
      action: "Scan the repository from GitHub instead, then open the fix pull request from that scan.",
      retryable: false,
    }),
  },
  {
    test: /CI configuration and repository metadata are never modified|every applicable edit targets CI configuration/i,
    build: () => ({
      kind: "denied",
      title: "Gatepass won't write these files",
      detail:
        "The only fixes available for this scan land in CI configuration, and Gatepass never modifies a pipeline — that rule has no exception and no override.",
      action: "Apply the guidance on those findings by hand.",
      retryable: false,
    }),
  },
  {
    test: /agent-loop integration is not enabled/i,
    build: () => ({
      kind: "unconfigured",
      title: "Fix guidance is turned off for this organization",
      detail:
        "Structured remediation is an opt-in feature, and it is currently disabled for your org. Findings and reproductions are unaffected.",
      action: "Turn on “Agent loop” in Settings to enable it.",
      retryable: false,
    }),
  },
  {
    test: /no (vanta|drata) API token configured/i,
    build: (m) => {
      const platform = m[1]!.toLowerCase() === "vanta" ? "Vanta" : "Drata";
      return {
        kind: "unconfigured",
        title: `${platform} isn't connected`,
        detail: `Exporting evidence sends control results to ${platform}, and this deployment has no ${platform} API token.`,
        action: "Export to the other platform instead, if your organization uses one.",
        operator: `Set ${platform === "Vanta" ? "VANTA_API_TOKEN" : "DRATA_API_TOKEN"} on the API service to connect it.`,
        retryable: false,
      };
    },
  },
  {
    /*
     * The dashboard reaches the API through its own same-origin proxy
     * (`app/api/gp/[...path]`), so an API that is down no longer surfaces as a browser
     * `TypeError` — it surfaces as this 502 from the proxy. Same cause, same message.
     */
    test: /upstream API unreachable at (\S+)/i,
    build: (m) => offlineError(m[1]!),
  },
  {
    test: /OAuth(\/session)? not configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "GitHub sign-in isn't set up",
      detail: "This deployment has no GitHub OAuth credentials, so it cannot start a sign-in flow.",
      operator: "Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET and SESSION_SECRET on the API service.",
      retryable: false,
    }),
  },
  {
    test: /no webhook secret configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "The GitHub webhook isn't set up",
      detail: "Incoming webhook deliveries are verified with a shared secret, and this deployment has none set.",
      operator: "Set GITHUB_WEBHOOK_SECRET on the API service to match the value in your GitHub App settings.",
      retryable: false,
    }),
  },
  {
    test: /Store does not support (.+)/i,
    build: (m) => ({
      kind: "unconfigured",
      title: "This deployment's storage can't do that",
      detail: `The API is running against a store that does not implement ${m[1]}. In-memory storage supports a subset of what Postgres does.`,
      operator: "Point the API at a PostgreSQL database with DATABASE_URL to enable it.",
      retryable: false,
    }),
  },
  {
    test: /Feature "(.+?)" requires a higher plan than "(.+?)"/i,
    build: (m) => ({
      kind: "denied",
      title: "That feature isn't on your plan",
      detail: `“${m[1]}” is not included in the ${m[2]} plan.`,
      action: "Upgrade the organization's plan to use it.",
      retryable: false,
    }),
  },
  {
    test: /Missing required config: (.+)/i,
    build: (m) => ({
      kind: "unconfigured",
      title: "This deployment is missing a setting",
      detail: `The Gatepass server needs ${m[1]} to do this, and that value is not set. Nothing is broken — it just isn't configured yet.`,
      operator: `Set ${m[1]} on the API service and restart it.`,
      retryable: false,
    }),
  },
  {
    test: /not a zip file/i,
    build: () => ({
      kind: "invalid",
      title: "That download wasn't a repository archive",
      detail:
        "GitHub returned something other than a tarball. This usually means the ref does not exist, or the Gatepass App has no access to that repository.",
      action: "Check the repository name and ref, and that the Gatepass App is installed on it.",
      retryable: false,
    }),
  },
  {
    test: /evidence push failed \((\d+)\)/i,
    build: (m) => ({
      kind: "server",
      title: "The compliance platform rejected the export",
      detail: `It answered ${m[1]}. Nothing was written on the Gatepass side, so it is safe to try again.`,
      action: "Check that the platform's API token is valid and has write access.",
      retryable: true,
    }),
  },
];

/** Turn any thrown value into something worth showing a person. */
export function explainError(err: unknown, ctx: ErrorContext = {}): FriendlyError {
  const technical = messageOf(err) || undefined;

  /*
   * Reaching the host at all comes first — nothing below matters if it is down.
   *
   * Which host, though, depends on where this ran. In the browser the request went to this
   * app's own origin (the `/api/gp` proxy), so a network failure means the dashboard is
   * unreachable and the API's address is neither known here nor the thing that broke. Naming
   * it would be a guess dressed as a diagnosis. When the proxy *does* reach the browser, an
   * unreachable API arrives as its 502 — and that rule, below, gets the address from the
   * proxy's own message, which is server-derived and correct.
   */
  if (isNetworkFailure(err)) {
    return { ...(typeof window === "undefined" ? offlineError(API_BASE) : browserOfflineError()), technical };
  }

  if (isAbort(err)) {
    return {
      kind: "timeout",
      title: "That took too long",
      detail: ctx.action
        ? `The request to ${ctx.action} did not finish in time and was stopped.`
        : "The request did not finish in time and was stopped.",
      action: "Try again. Large repositories can exceed the time budget on a small API instance.",
      technical,
      retryable: true,
    };
  }

  const status = err instanceof ApiError ? err.status : undefined;
  const raw = technical ?? "";

  for (const rule of PATTERNS) {
    const match = rule.test.exec(raw);
    if (match) return { ...rule.build(match, ctx), status, technical };
  }

  // A NotFoundError body is just "<resource> <id>", which is not a sentence.
  const resource = namedResource(raw);
  if (status === 404 || resource) {
    const label = resource ? (RESOURCE_LABEL[resource] ?? resource) : (ctx.subject ?? "resource");
    return {
      kind: "notFound",
      title: `That ${label} no longer exists`,
      detail: `Gatepass has no ${label} matching this request. It may have been deleted, or the link you followed may be out of date.`,
      action: resource === "scan" ? "Pick a scan from the Scans page." : undefined,
      status,
      technical,
      retryable: false,
    };
  }

  switch (status) {
    case 401:
      return {
        kind: "denied",
        title: "You're not signed in anymore",
        detail: "Your session is no longer valid, so Gatepass refused the request. This usually just means it expired.",
        action: "Sign in again, then retry.",
        status,
        technical,
        retryable: false,
      };
    case 403:
      return {
        kind: "denied",
        title: "Not allowed",
        detail: raw || "The API refused this request for this organization.",
        action: "Check the organization's plan and settings, or ask an admin.",
        status,
        technical,
        retryable: false,
      };
    case 422:
      return {
        kind: "invalid",
        title: "The API couldn't accept that",
        detail: raw || "The request was well-formed but its contents were rejected.",
        status,
        technical,
        retryable: false,
      };
    case 429: {
      const seconds = err instanceof ApiError ? err.retryAfter : undefined;
      return {
        kind: "rateLimited",
        title: "Too many requests",
        detail: seconds
          ? `This organization has hit its rate limit. It resets in about ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
          : "This organization has hit its rate limit.",
        action: "Wait a moment and try again.",
        status,
        technical,
        retryable: true,
      };
    }
    case 501:
      /*
       * The API says it does not do this — a capability the build supports that this deployment
       * has no credentials for (sign-in with GitHub, fix pull requests). It sits inside the 5xx
       * range but is not a fault, so it must not be styled as one or offer a retry: retrying is
       * futile, and painting configuration gaps red is how people learn to ignore red.
       */
      return {
        kind: "unconfigured",
        title: "That isn't set up on this deployment",
        detail: raw || "Gatepass can do this, but it has not been configured here. Nothing is broken.",
        operator: "This capability has to be configured on the API service before it will work.",
        status,
        technical,
        retryable: false,
      };
    default:
      break;
  }

  if (status && status >= 500) {
    return {
      kind: "server",
      title: "Something went wrong on Gatepass's side",
      detail: ctx.action
        ? `The server hit an error while trying to ${ctx.action}. This is a fault here, not something you did.`
        : "The server hit an error handling this request. This is a fault here, not something you did.",
      action: "Try again. If it keeps happening, the technical detail below is worth reporting.",
      status,
      technical,
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    title: ctx.action ? `Couldn't ${ctx.action}` : "Something went wrong",
    detail: raw || "No further detail was returned.",
    status,
    technical: raw ? technical : undefined,
    retryable: true,
  };
}

/**
 * One-line form, for a toast. Toasts have no room for a detail paragraph, so the
 * action is folded in only when it is short enough to still read as one thought.
 */
export function errorToast(err: unknown, ctx: ErrorContext = {}): string {
  const e = explainError(err, ctx);
  return e.action && e.action.length <= 80 ? `${e.title} — ${e.action}` : `${e.title}. ${e.detail}`;
}
