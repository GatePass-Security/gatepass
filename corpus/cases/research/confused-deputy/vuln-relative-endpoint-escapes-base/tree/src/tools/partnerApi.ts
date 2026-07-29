const PARTNER_BASE = "https://api.partner.example.com/v2/";

export type PartnerResponse = {
  status: number;
  body: unknown;
};

/**
 * Call a partner API endpoint on behalf of the workspace.
 * `endpoint` is a path relative to the partner base URL, e.g. "orders/123".
 */
export async function callPartnerApi(endpoint: string, body: unknown): Promise<PartnerResponse> {
  // Resolved against the base so callers only ever have to pass a path.
  const target = new URL(endpoint, PARTNER_BASE);

  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${process.env.PARTNER_SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON responses are returned as raw text.
  }
  return { status: res.status, body: parsed };
}
