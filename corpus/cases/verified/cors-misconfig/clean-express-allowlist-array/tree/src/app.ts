import cors from "cors";
import express from "express";

import { isAllowedOrigin } from "./origins";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and server-to-server calls send no Origin header at all.
      if (origin === undefined) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, origin);
      return callback(new Error(`origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // Request headers are not a trust boundary; the origin check above is.
    allowedHeaders: "*",
    maxAge: 600,
  }),
);

app.get("/api/me", (req, res) => {
  const session = req.headers.cookie?.match(/acme_session=([^;]+)/)?.[1];
  if (!session) return res.status(401).json({ error: "not signed in" });
  return res.json({ session, plan: "team" });
});

export default app;
