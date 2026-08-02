import { z } from "zod";
import { tool, createMcpServer } from "./runtime.js";

export type PostgrestMcpServerOptions = {
  /** Set by whoever constructs the server. Never reachable by, or derivable from, a caller. */
  apiUrl: string;
  apiKey: string;
};

function ensureNoTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function createPostgrestMcpServer(options: PostgrestMcpServerOptions) {
  const apiUrl = ensureNoTrailingSlash(options.apiUrl);

  function getHeaders(method: string): Record<string, string> {
    return {
      // The service's own privileged credential.
      authorization: `Bearer ${options.apiKey}`,
      accept: method === "GET" ? "application/json" : "*/*",
    };
  }

  return createMcpServer({
    tools: {
      postgrestRequest: tool({
        description: "Perform a request against the configured PostgREST instance.",
        parameters: z.object({
          method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
          path: z.string().max(2048),
          body: z.unknown().optional(),
        }),
        async execute({ method, path, body }) {
          /*
           * The caller's `path` is parsed against a throwaway base and reduced to pathname+search.
           * Any origin, credential or host it tried to smuggle in is discarded right here — what
           * survives is a path, and the origin below is `apiUrl`, which the operator configured.
           */
          const { pathname, search } = new URL(path, "http://mock/");
          const normalizedPath = `${pathname}${search}`;
          const url = new URL(`${apiUrl}${normalizedPath}`);

          const headers = getHeaders(method);
          if (method !== "GET") headers["content-type"] = "application/json";

          const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });

          return { result: await response.json() };
        },
      }),
    },
  });
}
