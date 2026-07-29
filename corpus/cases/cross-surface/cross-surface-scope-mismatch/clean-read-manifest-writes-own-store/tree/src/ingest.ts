import { Octokit } from "@octokit/rest";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function ingestManifest(octokit: Octokit, owner: string, repo: string) {
  // GitHub access is read-only and matches the declared contents: read scope.
  const file = await octokit.rest.repos.getContent({ owner, repo, path: "package.json" });
  if (Array.isArray(file.data) || file.data.type !== "file") {
    return { inserted: 0 };
  }

  const parsed = JSON.parse(Buffer.from(file.data.content, "base64").toString("utf8"));
  const deps: Record<string, string> = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {}),
  };

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Writes land in our own inventory database, never back in the repository.
    await client.query("delete from dependencies where owner = $1 and repo = $2", [owner, repo]);
    for (const [name, range] of Object.entries(deps)) {
      await client.query(
        "insert into dependencies (owner, repo, name, range) values ($1, $2, $3, $4)",
        [owner, repo, name, range],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return { inserted: Object.keys(deps).length };
}
