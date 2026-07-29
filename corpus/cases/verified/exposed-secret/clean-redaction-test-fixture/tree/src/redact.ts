const PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
  /\bxox[bpsa]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9-]{20,}\b/g,
  /\b(?:postgres|mysql|mongodb)(?:\+srv)?:\/\/[^\s:@]+:[^\s@]+@\S+/g,
];

export const REDACTION = "[REDACTED]";

/** Strip anything credential-shaped before a string reaches the log sink. */
export function redact(input: string): string {
  return PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTION), input);
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}
