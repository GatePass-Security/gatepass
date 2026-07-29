import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Branch, RowCount, SafePath, Sha } from "./scalars.js";
import { changedFiles, readAtRef } from "./git.js";

export const server = new McpServer({ name: "repo-tools", version: "2.1.0" });

server.tool(
  "read_file",
  "Read a file from the checked-out repository at a given commit.",
  { path: SafePath, ref: Sha, maxRows: RowCount },
  async ({ path, ref, maxRows }) => {
    const text = await readAtRef(ref, path);
    const body = text.split("\n").slice(0, maxRows).join("\n");
    return { content: [{ type: "text", text: body }] };
  }
);

server.tool(
  "list_changed",
  "List files changed on a branch relative to main.",
  { branch: Branch, limit: RowCount },
  async ({ branch, limit }) => {
    const files = await changedFiles(branch);
    return { content: [{ type: "text", text: files.slice(0, limit).join("\n") }] };
  }
);
