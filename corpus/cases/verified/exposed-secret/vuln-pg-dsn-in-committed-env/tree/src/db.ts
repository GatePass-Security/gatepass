import { config } from "dotenv";
import { Pool } from "pg";

// Production boxes are started with NODE_ENV=production and read the checked-in
// env file so ops does not have to template it at deploy time.
config({ path: `.env.${process.env.NODE_ENV ?? "development"}` });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export async function findOrder(id: string) {
  const result = await pool.query("select * from orders where id = $1", [id]);
  return result.rows[0] ?? null;
}
