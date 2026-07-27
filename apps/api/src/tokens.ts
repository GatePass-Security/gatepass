import { hashToken, safeEqual } from "@gatepass/shared";

/**
 * Bearer-token auth for the two write endpoints that are not reached through a
 * browser session: the self-hosted runner's results upload and the public
 * benchmark's publish.
 *
 * Both previously accepted writes from anyone. `POST /v1/runner/results` took
 * the target org from the request body, so a caller could name any org and
 * inject findings into its scan history; `POST /v1/benchmark/publish` let a
 * caller write arbitrary precision numbers to the public benchmark, which is
 * the product's entire credibility claim.
 *
 * Tokens are compared as SHA-256 digests with a constant-time equality, so
 * neither the token nor its length leaks through response timing. Plaintext
 * tokens are never retained — the registry keeps only hashes.
 *
 * Both guards FAIL CLOSED. An unconfigured deployment rejects every write
 * rather than falling back to the previous open behaviour, because a missing
 * env var must not silently reopen the hole it was added to close.
 */

/** `Authorization: Bearer <token>` → the token, or undefined. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || undefined;
}

export interface RunnerTokenEntry {
  orgId: string;
  token: string;
}

/**
 * Org-scoped runner tokens (`RunnerToken`, data-model.md:175). The org a runner
 * may write to is a property of its token, never of the payload — that binding
 * is what stops one customer's runner from uploading into another's org.
 */
export class RunnerTokenRegistry {
  /** orgId per token hash. Plaintext is discarded at construction. */
  private readonly entries: ReadonlyArray<{ orgId: string; hash: string }>;

  constructor(entries: readonly RunnerTokenEntry[] = []) {
    this.entries = entries.filter((e) => e.orgId && e.token).map((e) => ({ orgId: e.orgId, hash: hashToken(e.token) }));
  }

  get configured(): boolean {
    return this.entries.length > 0;
  }

  /**
   * The org this token may write to, or null. Every entry is compared even
   * after a match so lookup time does not depend on token position.
   */
  resolveOrg(token: string | undefined): string | null {
    if (!token || !this.configured) return null;
    const presented = hashToken(token);
    let match: string | null = null;
    for (const entry of this.entries) {
      if (safeEqual(presented, entry.hash)) match = entry.orgId;
    }
    return match;
  }
}

/**
 * Parse `GATEPASS_RUNNER_TOKENS` — comma-separated `orgId:token` pairs.
 * Malformed pairs are dropped rather than throwing, so one bad entry cannot
 * take the API down; the caller logs how many were accepted so a typo is
 * visible at startup instead of at the first upload.
 */
export function parseRunnerTokens(raw: string | undefined): RunnerTokenEntry[] {
  if (!raw?.trim()) return [];
  const entries: RunnerTokenEntry[] = [];
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    const orgId = pair.slice(0, sep).trim();
    const token = pair.slice(sep + 1).trim();
    if (orgId && token) entries.push({ orgId, token });
  }
  return entries;
}

/**
 * Single admin credential for publishing benchmark results. Not org-scoped:
 * the benchmark is global and immutable per corpus version, so this is an
 * operator action rather than a tenant one.
 */
export class AdminTokenGuard {
  private readonly hash: string | null;

  constructor(token?: string) {
    this.hash = token?.trim() ? hashToken(token.trim()) : null;
  }

  get configured(): boolean {
    return this.hash !== null;
  }

  accepts(token: string | undefined): boolean {
    if (!token || this.hash === null) return false;
    return safeEqual(hashToken(token), this.hash);
  }
}
