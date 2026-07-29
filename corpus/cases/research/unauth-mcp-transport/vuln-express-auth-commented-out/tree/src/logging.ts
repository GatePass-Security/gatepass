import type { NextFunction, Request, Response } from "express";

/**
 * Structured access log. It records who claimed to be calling but does not
 * verify any credential.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
        ua: req.header("user-agent") ?? "",
      }),
    );
  });
  next();
}
