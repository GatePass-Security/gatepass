import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Reads one file at one commit. Arguments are already schema-validated. */
export async function readAtRef(ref: string, path: string): Promise<string> {
  const { stdout } = await run("git", ["show", `${ref}:${path}`], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

/** Lists files changed on a branch relative to main. */
export async function changedFiles(branch: string): Promise<string[]> {
  const { stdout } = await run("git", ["diff", "--name-only", `main...${branch}`], {
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
  return stdout.split("\n").filter(Boolean);
}
