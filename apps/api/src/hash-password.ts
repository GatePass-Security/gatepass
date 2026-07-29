import { createInterface } from "node:readline";
import { hashPassword } from "@gatepass/shared";

/**
 * Turn a password into a `GATEPASS_LOCAL_USERS` entry.
 *
 *   pnpm --filter @gatepass/api hash-password admin
 *   pnpm --filter @gatepass/api hash-password admin admin   # login, then role
 *
 * The password is read from stdin, never from `argv`. An argument would be visible in `ps`
 * output to every other user on the machine and would land in the shell history file — for a
 * credential whose whole purpose is to be handed to somebody else, "it is already written down
 * in two places you forgot about" is the normal outcome rather than the unlucky one.
 *
 * Prints one entry to stdout. Append it to `GATEPASS_LOCAL_USERS`, comma-separated.
 */

const login = process.argv[2];
const role = process.argv[3] ?? "viewer";

if (!login) {
  console.error("usage: hash-password <login> [admin|member|viewer]   (password is read from stdin)");
  process.exit(2);
}
if (!["admin", "member", "viewer"].includes(role)) {
  console.error(`"${role}" is not a role. Use admin, member or viewer.`);
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, terminal: false });
process.stderr.write("password: ");
const password = await new Promise<string>((resolve) => rl.once("line", resolve));
rl.close();

if (password.length < 8) {
  // Not a policy, a floor. The hash is memory-hard, which buys nothing against a password
  // short enough to enumerate outright.
  console.error("that password is under 8 characters; scrypt cannot make a short password safe.");
  process.exit(2);
}

console.log(`${login}:${await hashPassword(password)}:${role}`);
