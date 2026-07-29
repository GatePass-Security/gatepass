const BUILT_IN = [
  "https://app.acme.com",
  "https://admin.acme.com",
  "https://partners.acme.com",
] as const;

function fromEnv(): string[] {
  const raw = process.env.EXTRA_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://"));
}

export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([...BUILT_IN, ...fromEnv()]);

/** Exact string comparison only. No prefixes, suffixes or regexes. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}
