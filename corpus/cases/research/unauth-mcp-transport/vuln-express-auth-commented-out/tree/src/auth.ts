import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Bearer-token check for the MCP endpoint.
 *
 * Written for INFRA-2291 but not currently mounted; see server.ts.
 */
export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.MCP_TOKEN ?? "";
  const presented = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (expected.length > 0 && a.length === b.length && timingSafeEqual(a, b)) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
