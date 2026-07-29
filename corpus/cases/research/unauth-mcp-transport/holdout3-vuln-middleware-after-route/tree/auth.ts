import type { Request, Response, NextFunction } from "express";

// A perfectly good API-key gate. The bug is not here — it is where this gets
// wired in (server.ts registers it *after* the MCP route, so Express never runs
// it for /mcp).
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-api-key");
  if (!key || key !== process.env.MCP_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
