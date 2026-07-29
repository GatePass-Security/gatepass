import { pool } from "../db.js";

export type ExportRequest = {
  table: "events" | "sessions" | "invoices";
  rowLimit: number;
  filters?: Record<string, unknown>;
};

export type ExportResponse = {
  rows: Array<Record<string, unknown>>;
};

export async function exportRows(request: ExportRequest): Promise<ExportResponse> {
  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const [column, value] of Object.entries(request.filters ?? {})) {
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(request.rowLimit);

  const sql = `SELECT * FROM ${request.table} ${where} LIMIT $${values.length}`;
  const result = await pool.query(sql, values);
  return { rows: result.rows };
}
