import cors from "@fastify/cors";
import Fastify from "fastify";

import { currentIncidents, uptime } from "./status";

const app = Fastify({ logger: true });

// This service is the public status page feed. It has no sessions, reads no
// cookies and never issues a Set-Cookie, so a wildcard origin exposes nothing
// that is not already anonymous. Credentials stay off deliberately.
await app.register(cors, {
  origin: "*",
  credentials: false,
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 3600,
});

app.get("/v1/uptime", async () => ({ window: "30d", ...uptime() }));

app.get("/v1/incidents", async () => ({ incidents: currentIncidents() }));

app.get("/healthz", async () => ({ ok: true }));

await app.listen({ port: 8081, host: "0.0.0.0" });
