import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://app@localhost:5432/billing',
  max: 10,
});
