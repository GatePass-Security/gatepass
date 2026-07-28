import { API_BASE } from "./constants";
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
  /** The next thing to do. Omitted when there genuinely isn't one. */
  action?: string;
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
      action:
        "Scan a directory the API can already read using the “Path on host” option, which needs no setup. To enable cloning, set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_INSTALLATION_ID on the API service and restart it.",
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
        action: `Set ${platform === "Vanta" ? "VANTA_API_TOKEN" : "DRATA_API_TOKEN"} on the API service, or export to the other platform.`,
        retryable: false,
      };
    },
  },
  {
    test: /OAuth(\/session)? not configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "GitHub sign-in isn't set up",
      detail: "This deployment has no GitHub OAuth credentials, so it cannot start a sign-in flow.",
      action: "Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET and SESSION_SECRET on the API service.",
      retryable: false,
    }),
  },
  {
    test: /no webhook secret configured/i,
    build: () => ({
      kind: "unconfigured",
      title: "The GitHub webhook isn't set up",
      detail: "Incoming webhook deliveries are verified with a shared secret, and this deployment has none set.",
      action: "Set GITHUB_WEBHOOK_SECRET on the API service to match the value in your GitHub App settings.",
      retryable: false,
    }),
  },
  {
    test: /Store does not support (.+)/i,
    build: (m) => ({
      kind: "unconfigured",
      title: "This deployment's storage can't do that",
      detail: `The API is running against a store that does not implement ${m[1]}. In-memory storage supports a subset of what Postgres does.`,
      action: "Point the API at a PostgreSQL database with DATABASE_URL to enable it.",
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
      title: "The API is missing a setting",
      detail: `It needs ${m[1]} and that value is not set.`,
      action: `Set ${m[1]} on the API service and restart it.`,
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

  // Reaching the host at all comes first — nothing below matters if it is down.
  if (isNetworkFailure(err)) {
    return {
      kind: "offline",
      title: "Can't reach the Gatepass API",
      detail: `No response from ${API_BASE}. The API may be starting up, asleep, or blocked by a network rule.`,
      action: "Check the API is running, then try again.",
      technical,
      retryable: true,
    };
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
      detail: `The API has no ${label} matching this request. It may have been removed, or the link you followed is out of date.`,
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
        title: "Not signed in",
        detail: "The API rejected this request because it carried no valid credential.",
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
    default:
      break;
  }

  if (status && status >= 500) {
    return {
      kind: "server",
      title: "The API hit an error",
      detail: ctx.action
        ? `Something went wrong on the server while trying to ${ctx.action}.`
        : "Something went wrong on the server handling this request.",
      action: "Try again. If it keeps happening, the detail below is worth reporting.",
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
