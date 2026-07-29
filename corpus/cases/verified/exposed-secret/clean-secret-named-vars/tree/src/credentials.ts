import { readFileSync } from "node:fs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// These names look alarming on purpose; every one of them is a lookup.
export const apiKey = required("ACME_API_KEY");
export const password = required("DB_PASSWORD");
export const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
export const privateKey = readFileSync(required("SIGNING_KEY_PATH"), "utf8");

export const authorizationHeader = `Bearer ${apiKey}`;

export const databaseUrl =
  `postgres://${required("DB_USER")}:${encodeURIComponent(password)}` +
  `@${required("DB_HOST")}:5432/${required("DB_NAME")}?sslmode=require`;

export function describe(): string {
  return `key ${apiKey.slice(0, 4)}… / key file ${privateKey.length} bytes`;
}
