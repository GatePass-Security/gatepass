/**
 * Starts the API and the dashboard together.
 *
 * The dashboard is useless without the API — every page but /compliance and /docs fetches from
 * it, and the failure mode is a full-page "Can't reach the Gatepass API" error that looks like a
 * broken product. There was no single command that brought both up, so anyone demoing had to know
 * to start the API in a second terminal. Now they don't.
 *
 *   pnpm dev
 *
 * No process-runner dependency: `child_process` does the whole job, and one less package in a
 * security product's tree is worth ten lines of script.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.PORT ?? "3000";
const WEB_PORT = process.env.WEB_PORT ?? "3001";

/** Windows resolves `npx`/`pnpm` through .cmd shims, which need a shell. */
const useShell = process.platform === "win32";

const PALETTE = { api: "\x1b[36m", web: "\x1b[35m", reset: "\x1b[0m", dim: "\x1b[2m" };

const children = [];

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: useShell, env: process.env });
  const tag = `${PALETTE[name]}${name.padEnd(3)}${PALETTE.reset} ${PALETTE.dim}│${PALETTE.reset} `;

  const pipe = (stream, sink) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) sink.write(`${tag}${line}\n`);
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`${tag}exited with code ${code}\n`);
    }
    shutdown(code ?? 0);
  });

  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** A stale process on either port otherwise surfaces as a raw EADDRINUSE stack trace. */
function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(Number(port), "0.0.0.0");
  });
}

for (const [label, port] of [
  ["API", API_PORT],
  ["Dashboard", WEB_PORT],
]) {
  if (!(await portFree(port))) {
    console.error(
      `\n  Port ${port} (${label}) is already in use.\n` +
        `  Something is still running from a previous session. Free it, then retry:\n\n` +
        (process.platform === "win32"
          ? `    Get-NetTCPConnection -LocalPort ${port} -State Listen | Stop-Process -Id { $_.OwningProcess } -Force\n`
          : `    lsof -ti tcp:${port} | xargs kill\n`),
    );
    process.exit(1);
  }
}

console.log(`
  Gatepass — local stack
    API        http://localhost:${API_PORT}
    Dashboard  http://localhost:${WEB_PORT}
    Landing    http://localhost:${WEB_PORT}/

  Ctrl-C stops both.
`);

run("api", "npx", ["tsx", "apps/api/src/index.ts"], ROOT);
run("web", "npx", ["next", "dev", "-p", WEB_PORT], resolve(ROOT, "apps/web"));
