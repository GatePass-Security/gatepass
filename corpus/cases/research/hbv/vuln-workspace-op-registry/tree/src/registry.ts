import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Handler = (args: string[]) => Promise<string>;

/**
 * Operations reachable through the workspace tool. Entries can be added here
 * without touching the tool schema, which is why `op` is left as a free-form
 * string rather than an enum.
 */
export const OPS: Record<string, Handler> = {
  read: async ([path]) => fs.readFile(path, "utf8"),

  write: async ([path, body]) => {
    await fs.writeFile(path, body ?? "", "utf8");
    return `wrote ${path}`;
  },

  remove: async ([path]) => {
    await fs.rm(path, { recursive: true, force: true });
    return `removed ${path}`;
  },

  move: async ([from, to]) => {
    await fs.rename(from, to);
    return `moved ${from} -> ${to}`;
  },

  shell: async (args) => {
    const { stdout, stderr } = await run("/bin/sh", ["-c", args.join(" ")], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout || stderr;
  },
};
