import Fastify from "fastify";
import { bearerHook } from "./auth.js";
import { loadConfig } from "./config.js";
import { mcpRoutes } from "./routes.js";

const config = loadConfig();
const app = Fastify({ logger: true });

if (config.authRequired) {
  app.addHook("onRequest", bearerHook(config.token));
}

await app.register(mcpRoutes, { prefix: "/mcp" });

app.get("/healthz", async () => ({ status: "ok" }));

await app.listen({ host: config.host, port: config.port });
app.log.info(`crm mcp listening on ${config.host}:${config.port}`);
