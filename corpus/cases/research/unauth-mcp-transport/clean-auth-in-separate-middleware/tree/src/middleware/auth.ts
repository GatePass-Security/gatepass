import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const TOKEN = process.env.MCP_TOKEN;
if (!TOKEN) {
  throw new Error("MCP_TOKEN must be set; refusing to start an unauthenticated MCP endpoint");
}
const expected = Buffer.from(TOKEN);

/**
 * Requires `Authorization: Bearer <MCP_TOKEN>` on every request it guards.
 * Comparison is constant time and length is checked first so timingSafeEqual
 * never throws on a mismatched buffer length.
 */
export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const presented = Buffer.from((req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
