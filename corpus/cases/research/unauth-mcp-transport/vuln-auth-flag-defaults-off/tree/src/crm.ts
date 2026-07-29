import { Pool } from "pg";

const pool = new Pool({
  host: process.env.PGHOST ?? "db",
  database: process.env.PGDATABASE ?? "crm",
  user: process.env.PGUSER ?? "crm_app",
  password: process.env.PGPASSWORD,
  max: 8,
});

export type ContactPatch = { email?: string; phone?: string };

export async function updateContact(contactId: string, patch: ContactPatch): Promise<void> {
  await pool.query(
    "UPDATE contacts SET email = COALESCE($2, email), phone = COALESCE($3, phone) WHERE id = $1",
    [contactId, patch.email ?? null, patch.phone ?? null],
  );
}
