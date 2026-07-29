const TOKEN_ENDPOINT = "https://auth.internal.example/oauth2/token";
const DOWNSTREAM = "https://api.internal.example/reports";

/**
 * Exchange the caller's own token for a downstream token that carries the
 * caller's identity and scopes. Our client secret authenticates us to the
 * token endpoint only; it is never sent downstream, and the downstream token
 * can do no more than the caller already could.
 */
async function exchangeForCaller(subjectToken: string): Promise<string> {
  const basic = Buffer.from(`reports-svc:${process.env.CLIENT_SECRET}`).toString("base64");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subjectToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: "reports.read",
    }),
  });

  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function fetchReport(req: Request, reportId: string) {
  const caller = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!caller) throw new Error("unauthenticated");

  const delegated = await exchangeForCaller(caller);
  return fetch(`${DOWNSTREAM}/${encodeURIComponent(reportId)}`, {
    headers: { authorization: `Bearer ${delegated}` },
  });
}
