import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/**
 * Parses the request body against `schema` and replaces req.body with the
 * parsed value, so downstream handlers only ever observe data that matched.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({ error: 'invalid_body', issues: result.error.issues });
      return;
    }

    req.body = result.data;
    next();
  };
}
