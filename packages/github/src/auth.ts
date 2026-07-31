import { createPrivateKey } from "node:crypto";
import jwt from "jsonwebtoken";

/** `-----BEGIN [RSA ]PRIVATE KEY-----` … matching `END`, with whatever body lies between. */
const PEM_SHAPE = /^-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----([\s\S]+?)-----END \1PRIVATE KEY-----$/;

/**
 * Repair the ways a PEM gets damaged on its way into an environment variable, or explain why
 * this one cannot be repaired.
 *
 * A GitHub App private key is a multi-line file. Environment variables are one line. Everything
 * in between — `.env` files, hosting dashboards, CI secret stores, shell `export` — has its own
 * idea of what to do about that, and the three common outcomes are all recoverable:
 *
 *  - the newlines arrive as the two characters `\` and `n`, because the value was written the way
 *    a `.env` file wants it;
 *  - the whole value is still wrapped in the quotes it was pasted with;
 *  - the newlines are gone entirely, flattened to spaces by a single-line form field.
 *
 * Base64 does not care where its line breaks fall, so the body can simply be re-wrapped. What
 * this must not do is guess: anything that is not a PEM at all is reported as such, because the
 * error it otherwise produces is `secretOrPrivateKey must be an asymmetric key when using RS256`,
 * which names neither the variable at fault nor anything an operator can act on. That message
 * took a deployment down and read as a code defect.
 */
export function normalizeAppPrivateKey(raw: string): string {
  let pem = raw.trim();

  const quoted = /^(["'])([\s\S]*)\1$/.exec(pem);
  if (quoted) pem = quoted[2]!.trim();

  // Trimmed again afterwards: the escaped trailing newline every PEM file ends with survives the
  // first trim as two ordinary characters, and JavaScript's `$` — unlike Perl's — does not match
  // before a final newline, so leaving it makes the shape test below reject a repairable key.
  if (pem.includes("\\n")) pem = pem.replace(/\\r\\n|\\r|\\n/g, "\n").trim();

  const shape = PEM_SHAPE.exec(pem);
  if (!shape) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is not a PEM private key: no matching " +
        "`-----BEGIN … PRIVATE KEY-----` / `-----END … PRIVATE KEY-----` pair. GitHub downloads a " +
        "`.pem` file when you generate an App key — paste that entire file, including both marker " +
        "lines. It is not the App's client secret, and not the public key.",
    );
  }

  const label = shape[1]!;
  const body = shape[2]!.replace(/\s+/g, "");
  const wrapped = body.replace(/.{64}/g, "$&\n").replace(/\n$/, "");
  pem = `-----BEGIN ${label}PRIVATE KEY-----\n${wrapped}\n-----END ${label}PRIVATE KEY-----\n`;

  try {
    createPrivateKey(pem);
  } catch (err) {
    throw new Error(`GITHUB_APP_PRIVATE_KEY has the shape of a PEM but could not be read: ${(err as Error).message}`, {
      cause: err,
    });
  }
  return pem;
}

/**
 * Configuration for a GitHub App installation (T096).
 */
export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

/**
 * Generate a JWT for a GitHub App using its private key.
 * The JWT expires in 10 minutes (GitHub max) and is used to request
 * an installation access token.
 */
function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // 60s clock skew tolerance
    exp: now + 600, // 10 minutes
    iss: appId,
  };
  return jwt.sign(payload, normalizeAppPrivateKey(privateKey), { algorithm: "RS256" });
}

/**
 * Exchange a GitHub App JWT for an installation access token.
 * Returns the token string and its expiry.
 */
export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export async function getInstallationToken(config: GitHubAppConfig): Promise<InstallationToken> {
  const appJwt = createAppJwt(config.appId, config.privateKey);
  const url = `https://api.github.com/app/installations/${config.installationId}/access_tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${appJwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`GitHub App auth failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  return { token: json.token, expiresAt: new Date(json.expires_at) };
}
