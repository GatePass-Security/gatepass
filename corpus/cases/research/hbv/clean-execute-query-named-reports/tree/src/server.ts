import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

/** Every statement lives here. The caller only picks a key and a date. */
const REPORTS = {
  "daily-signups": "SELECT day, signups FROM rpt_daily_signups WHERE day >= $1 ORDER BY day",
  "churn-by-plan": "SELECT plan, churn_rate FROM rpt_churn WHERE month = $1 ORDER BY plan",
  "top-accounts": "SELECT account_id, mrr FROM rpt_top_accounts WHERE month = $1 ORDER BY mrr DESC LIMIT 50",
} as const;

export const server = new McpServer({ name: "reporting", version: "2.2.0" });

server.tool(
  "execute_query",
  "Runs one of three pre-written, read-only reporting queries and returns its rows. The caller selects a report by name and supplies a single ISO date; no SQL text is accepted from the caller.",
  {
    report: z.enum(["daily-signups", "churn-by-plan", "top-accounts"]),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  },
  async ({ report, since }) => {
    const { rows } = await pool.query(REPORTS[report], [since]);
    return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
  },
);

await server.connect(new StdioServerTransport());
