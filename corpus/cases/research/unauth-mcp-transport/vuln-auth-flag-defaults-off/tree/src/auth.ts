import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/** onRequest hook that requires a matching bearer token. */
export function bearerHook(expected: string) {
  const want = Buffer.from(expected);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const presented = Buffer.from(
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""),
    );
    if (presented.length !== want.length || !timingSafeEqual(presented, want)) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  };
}
