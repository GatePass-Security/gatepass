import { Pool } from "pg";

/**
 * Connects as `analytics_admin`, which holds read and write privileges on every
 * schema in the warehouse including the billing and pii schemas.
 */
export const pool = new Pool({
  host: process.env.PGHOST ?? "warehouse.internal",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "warehouse",
  user: process.env.PGUSER ?? "analytics_admin",
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
});
