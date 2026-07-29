/**
 * GitHub OAuth sign-in (FR-027, T076). Exchanges the OAuth `code` for a user access token and
 * resolves the authenticated GitHub user. `fetchImpl` is injectable so the exchange is
 * unit-testable without hitting GitHub; the real flow needs a registered OAuth app.
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Where GitHub redirects back after authorization. */
  redirectUri?: string;
}

export interface GitHubUser {
  githubUserId: number;
  login: string;
  accessToken: string;
}

type FetchLike = typeof fetch;

/**
 * Scopes requested at sign-in.
 *
 * `read:org` is here so the session's role can be derived from the user's actual GitHub
 * organization membership instead of being assumed — `authCallback` used to hardcode
 * `role: "member"` for everyone, which made the whole role hierarchy decorative. It is the
 * narrowest scope that answers "is this person an owner of the org", and it grants no access
 * to code. Nothing here asks for `repo`: Gatepass reads repositories through its App
 * installation, never through a user token.
 */
export const DEFAULT_OAUTH_SCOPE = "read:user read:org";

/** The URL to send a user to in order to begin the OAuth flow. */
export function authorizeUrl(config: OAuthConfig, state: string, scope = DEFAULT_OAUTH_SCOPE): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope,
    state,
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export class OAuthError extends Error {}

/** Exchange an OAuth `code` for an access token and the authenticated user. */
export async function exchangeCodeForUser(
  code: string,
  config: OAuthConfig,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubUser> {
  const tokenRes = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    }),
  });
  if (!tokenRes.ok) throw new OAuthError(`token exchange failed (${tokenRes.status})`);
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw new OAuthError(`no access token (${tokenJson.error ?? "unknown"})`);

  const userRes = await fetchImpl("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!userRes.ok) throw new OAuthError(`user lookup failed (${userRes.status})`);
  const user = (await userRes.json()) as { id?: number; login?: string };
  if (!user.id || !user.login) throw new OAuthError("incomplete user profile");

  return { githubUserId: user.id, login: user.login, accessToken: tokenJson.access_token };
}

/** A user's membership in one GitHub organization, as GitHub reports it. */
export interface OrgMembership {
  /** `"active"`, or `"pending"` for an unaccepted invitation. */
  state: string;
  /** `"admin"` (owner) or `"member"`. */
  role: string;
}

/**
 * Read the signed-in user's membership of `org` using their own access token
 * (`GET /user/memberships/orgs/{org}`, needs the `read:org` scope).
 *
 * Returns undefined when GitHub says the user is not a member (404) or the token lacks the
 * scope (403). Both are answers rather than failures, and both must resolve to the *lowest*
 * privilege — so this deliberately does not throw, and the caller treats undefined as "no
 * membership established".
 */
export async function fetchOrgMembership(
  org: string,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<OrgMembership | undefined> {
  const res = await fetchImpl(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { state?: string; role?: string };
  if (!json.role) return undefined;
  return { state: json.state ?? "active", role: json.role };
}
