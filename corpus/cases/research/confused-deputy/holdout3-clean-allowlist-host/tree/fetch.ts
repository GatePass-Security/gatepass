// Attaches the server's partner credential to an outbound request — but only
// after the caller-supplied URL is parsed and its host confirmed to be on a
// fixed allowlist. A URL pointing anywhere else is rejected before the secret
// is ever attached, so the caller cannot redirect the credential.

const ALLOWED_HOSTS = new Set(["api.partner.example", "eu.partner.example"]);
const PARTNER_KEY = process.env.PARTNER_API_KEY!;

export async function relay(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`host not allowed: ${url.hostname}`);
  }
  const resp = await fetch(url, {
    headers: { authorization: `Bearer ${PARTNER_KEY}` },
  });
  return resp.text();
}
