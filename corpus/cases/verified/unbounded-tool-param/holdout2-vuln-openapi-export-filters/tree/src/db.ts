import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.ANALYTICS_DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000,
  statement_timeout: 60_000,
});

pool.on("error", (error) => {
  console.error("analytics pool error", error);
});

export async function close(): Promise<void> {
  await pool.end();
}
