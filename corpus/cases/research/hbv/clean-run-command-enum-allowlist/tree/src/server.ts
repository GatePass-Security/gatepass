import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const run = promisify(execFile);

/** Fixed argv per command name. No caller-supplied text ever reaches a shell. */
const COMMANDS = {
  status: ["/usr/bin/systemctl", "is-active", "buildbot.service"],
  version: ["/usr/local/bin/buildbot", "--version"],
  uptime: ["/usr/bin/uptime", "-p"],
  disk_free: ["/bin/df", "-h", "/var/lib/buildbot"],
} as const;

type CommandName = keyof typeof COMMANDS;

export const server = new McpServer({ name: "buildbot-ops", version: "1.0.3" });

server.tool(
  "run_command",
  "Runs one of four fixed, read-only diagnostic commands on this build agent and returns its stdout. The command is selected from a closed list; the caller cannot supply arguments and nothing is passed to a shell.",
  { command: z.enum(["status", "version", "uptime", "disk_free"]) },
  async ({ command }) => {
    const [bin, ...args] = COMMANDS[command as CommandName];
    const { stdout } = await run(bin, [...args], { timeout: 10_000, shell: false });
    return { content: [{ type: "text" as const, text: stdout.trim() }] };
  },
);

await server.connect(new StdioServerTransport());
