import { z } from "zod";
import { server, log, asText } from "./runtime.js";

const apiBase = process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev";

/*
 * The tool's input schema is declared here and applied by the SDK at dispatch: `server.tool` will
 * not call the handler with anything that does not match it, so the handler never validates by
 * hand.
 */
const FeedbackInput = z.object({
  endpoint: z.string().max(256),
  jobId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
});

server.tool("submit_endpoint_feedback", FeedbackInput, async ({ endpoint, jobId, rating }) => {
  const headers = { "content-type": "application/json" };
  const body = { endpoint, jobId, rating, origin: "mcp" };

  log.info("Submitting endpoint feedback", { endpoint, jobId, rating });
  const response = await fetch(`${apiBase}/v2/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  /*
   * Everything below is the UPSTREAM SERVICE'S REPLY. It is `any` because the endpoint answers
   * with JSON or with a bare string, and it is read for a status field and handed back to the
   * caller. No model-controlled value reaches it, and a schema here would be validating
   * Firecrawl's answer to us rather than anything anyone sent in.
   */
  const responseText = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = { raw: responseText };
  }

  if (!response.ok) {
    log.warn("Endpoint feedback rejected", {
      status: response.status,
      feedbackErrorCode: parsed?.feedbackErrorCode,
    });
  }

  return asText(parsed);
});
