import { z } from "zod";

/**
 * Response shapes returned by the Cloudflare Workers API.
 *
 * These describe what the upstream service *sends back*. They are parsed, never accepted from a
 * model, and no bound on them would be meaningful: a `maxLength` here would reject Cloudflare's
 * own reply rather than constrain anything a caller can send.
 */
export const WorkersService = z.object({
  id: z.string(),
  created_on: z.string(),
  default_environment: z.object({
    environment: z.string(),
    created_on: z.string(),
    modified_on: z.string(),
    script: z.object({
      id: z.string(),
      tag: z.string(),
      etag: z.string(),
      handlers: z.array(z.string()),
      last_deployed_from: z.string(),
    }),
  }),
});

export const WorkersServiceList = z.object({
  result: z.array(WorkersService),
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })),
});

export type WorkersService = z.infer<typeof WorkersService>;
export type WorkersServiceList = z.infer<typeof WorkersServiceList>;
