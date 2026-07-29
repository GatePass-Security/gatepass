import cors from "cors";
import express from "express";

const DASHBOARD_ORIGIN = "https://app.acme.com";

const app = express();

app.use(
  cors({
    origin: DASHBOARD_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/profile", (req, res) => {
  const session = req.headers.cookie?.match(/acme_session=([^;]+)/)?.[1];
  if (!session) return res.status(401).json({ error: "not signed in" });
  return res.json({ id: "usr_7f31", email: "dana@acme.com" });
});

export default app;
