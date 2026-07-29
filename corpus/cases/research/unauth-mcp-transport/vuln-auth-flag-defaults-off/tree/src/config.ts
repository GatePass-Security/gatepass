export type ServerConfig = {
  host: string;
  port: number;
  authRequired: boolean;
  token: string;
};

/** Built once at boot from the process environment. */
export function loadConfig(): ServerConfig {
  return {
    host: process.env.MCP_HOST ?? "0.0.0.0",
    port: Number(process.env.MCP_PORT ?? 8080),
    // Opt-in, so local development and the docker-compose demo work out of the box.
    authRequired: process.env.MCP_AUTH === "1",
    token: process.env.MCP_TOKEN ?? "",
  };
}
