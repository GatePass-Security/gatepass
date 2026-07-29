import { Octokit } from "@octokit/rest";

export async function cutRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  version: string,
  changelog: string,
) {
  const main = await octokit.rest.git.getRef({ owner, repo, ref: "heads/main" });

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/tags/v${version}`,
    sha: main.data.object.sha,
  });

  const existing = await octokit.rest.repos.getContent({ owner, repo, path: "CHANGELOG.md" });
  const sha = Array.isArray(existing.data) ? undefined : (existing.data as { sha: string }).sha;

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: "CHANGELOG.md",
    message: `chore(release): v${version}`,
    content: Buffer.from(changelog, "utf8").toString("base64"),
    sha,
  });

  return { tag: `v${version}` };
}
