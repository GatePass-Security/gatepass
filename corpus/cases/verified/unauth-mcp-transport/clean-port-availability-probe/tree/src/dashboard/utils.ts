import { createServer } from "net";

// Shown in the dashboard banner once the socket check has passed.
export const DASHBOARD_TEST_MESSAGE = "MCP Workflow Dashboard Online!";

/**
 * Is `port` free on `host`?
 *
 * The socket is opened only to find out, and closed inside the listen callback before anything can
 * connect to it. Nothing is served here and no transport is registered.
 */
async function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.listen(port, host, () => {
      server.once("close", () => resolve(true));
      server.close();
    });

    server.on("error", () => resolve(false));
  });
}

export async function findAvailablePort(start: number, host: string): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`No free port in ${start}-${start + 99}`);
}
