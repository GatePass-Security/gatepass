import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for the local sign-in — the door that exists so somebody can look at a
 * Gatepass deployment without a GitHub account.
 *
 * ## Why hashes rather than a password in the environment
 *
 * A deployment configures `GATEPASS_LOCAL_USERS` with a *hash*, so the plaintext exists only in
 * the head of whoever set it. That matters more here than it usually would: this credential is
 * by nature shared and handed around — that is its whole purpose — and shared credentials end
 * up in chat logs, screenshots and process listings. A hash in the environment cannot be read
 * off a `ps` output or a leaked `.env` and used to sign in anywhere else the same password was
 * reused.
 *
 * ## Why scrypt
 *
 * It is memory-hard, so a stolen hash resists GPU cracking in a way PBKDF2 and plain SHA do
 * not, and it is in Node's standard library — no dependency to audit for a security primitive.
 * The cost parameters are stored *in the hash*, so raising them later does not invalidate
 * existing hashes: an old one keeps verifying with the parameters it was made with.
 *
 * ## What this is not
 *
 * It is not a user system. There is no registration, no reset, no lockout state here — this is
 * one function that answers "does this string match that hash" without leaking timing, and a
 * format that carries its own parameters. Everything about *who may try* lives in the API.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters for new hashes. N=2^15 is roughly 100ms and ~32MB — deliberately slow. */
const DEFAULTS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * `scrypt.N.r.p.saltHex.hashHex`. Self-describing, so parameters can change without a migration.
 *
 * Dot-separated rather than the conventional `$`, because this value is delivered as an
 * environment variable and `$` is a shell metacharacter. `set -a; . .env` expands `$32768` to
 * nothing, silently producing a hash that parses as garbage and an account that cannot sign in
 * — which presents as "the password is wrong", the one diagnosis that sends you looking in
 * entirely the wrong place. Nothing in this alphabet means anything to a shell.
 */
const PREFIX = "scrypt";
const SEP = ".";

/** Bound on scrypt's memory use, so a hostile `N` in a stored hash cannot exhaust the process. */
function maxmem(N: number, r: number): number {
  return 256 * N * r + 1024 * 1024;
}

/** Hash a password for storage in `GATEPASS_LOCAL_USERS`. */
export async function hashPassword(password: string, params = DEFAULTS): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, { ...params, maxmem: maxmem(params.N, params.r) });
  return [PREFIX, params.N, params.r, params.p, salt.toString("hex"), key.toString("hex")].join(SEP);
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

/**
 * Parse a stored hash, or undefined if it is not one.
 *
 * Every bound here is a refusal rather than a clamp. A hash with an absurd `N` would let a
 * malformed environment variable turn one sign-in attempt into gigabytes of allocation, and a
 * hash we cannot parse is not a hash we should be guessing about — an unparseable entry must
 * mean "nobody signs in as this user", never "let them in".
 */
export function parsePasswordHash(stored: string): ParsedHash | undefined {
  const parts = stored.split(SEP);
  if (parts.length !== 6 || parts[0] !== PREFIX) return undefined;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 1024 || N > 1 << 20) return undefined;
  if (!Number.isInteger(r) || r < 1 || r > 32) return undefined;
  if (!Number.isInteger(p) || p < 1 || p > 16) return undefined;
  if (!/^[0-9a-f]+$/i.test(parts[4] ?? "") || !/^[0-9a-f]+$/i.test(parts[5] ?? "")) return undefined;
  const key = Buffer.from(parts[5]!, "hex");
  if (key.length !== KEY_LEN) return undefined;
  return { N, r, p, salt: Buffer.from(parts[4]!, "hex"), key };
}

/**
 * Whether `password` matches `stored`.
 *
 * `timingSafeEqual` rather than `===`, so the comparison does not leak how much of a guess was
 * right. That is the cheap half; the expensive half is `verifyNothing` below, which is what
 * keeps *which logins exist* from leaking through response time.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const key = await scrypt(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmem(parsed.N, parsed.r),
  });
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

/**
 * Burn the same work a real verification would, and return false.
 *
 * Called when the login does not exist. Without it, an unknown user is refused in microseconds
 * while a known one takes ~100ms of scrypt — which turns the sign-in form into an oracle for
 * enumerating valid logins, and the answer to "is `admin` a real account here" is the first
 * thing worth knowing before attacking one.
 */
export async function verifyNothing(password: string): Promise<false> {
  await scrypt(password, Buffer.alloc(SALT_LEN), KEY_LEN, { ...DEFAULTS, maxmem: maxmem(DEFAULTS.N, DEFAULTS.r) });
  return false;
}
