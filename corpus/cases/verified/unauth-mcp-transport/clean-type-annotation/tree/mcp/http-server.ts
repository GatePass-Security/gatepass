import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk";

export type CreateServerOptions = {
  transport: "stdio" | "http";
  outputFormat?: "tree" | "json";
};

function createServer(options: CreateServerOptions) {
  return new McpServer(options);
}

export class McpHttpServer {
  private startKeepAliveLoop(transport: StreamableHTTPServerTransport, server: Server): NodeJS.Timeout | undefined {
    return setInterval(() => transport.send({ method: "ping" }), 30_000);
  }
}
