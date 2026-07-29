import { Pool } from "pg";

/**
 * `reporting_ro` is granted SELECT on the rpt_* views only. It has no rights on
 * the base tables, the billing schema, or the pii schema.
 */
export const pool = new Pool({
  host: process.env.PGHOST ?? "warehouse.internal",
  port: Number(process.env.PGPORT ?? 5432),
  database: "warehouse",
  user: "reporting_ro",
  password: process.env.PGPASSWORD,
  max: 4,
  statement_timeout: 15_000,
});
