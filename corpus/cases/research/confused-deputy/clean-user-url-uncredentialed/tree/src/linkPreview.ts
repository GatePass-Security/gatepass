const METADATA_API = "https://metadata.internal.example/v1/enrich";

export type Preview = {
  url: string;
  title: string;
  enrichment: unknown;
};

export async function buildPreview(userUrl: string, workspaceId: string): Promise<Preview> {
  // Untrusted destination. No credential of ours is attached, redirects are
  // refused, and the response is size-capped.
  const page = await fetch(userUrl, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "preview-bot/2.0 (+https://example.com/bots)",
    },
    signal: AbortSignal.timeout(5000),
  });

  const html = (await page.text()).slice(0, 100_000);
  const title = /<title[^>]*>([^<]{0,200})/i.exec(html)?.[1]?.trim() ?? userUrl;

  // Our own credential is only ever sent to our own fixed endpoint.
  const enriched = await fetch(METADATA_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SERVICE_TOKEN}`,
    },
    body: JSON.stringify({ workspaceId, title }),
  });

  return { url: userUrl, title, enrichment: await enriched.json() };
}
