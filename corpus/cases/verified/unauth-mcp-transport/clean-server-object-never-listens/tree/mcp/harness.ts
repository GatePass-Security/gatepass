import http from "node:http";
import net from "node:net";

export async function withStubServer(handler: http.RequestListener) {
  const httpServer = http.createServer(async (req, res) => handler(req, res));
  const probe = net.createServer();
  httpServer.listen(0);
  return { httpServer, probe };
}
