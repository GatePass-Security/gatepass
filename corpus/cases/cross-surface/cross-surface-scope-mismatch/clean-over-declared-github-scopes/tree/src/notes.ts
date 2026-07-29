import { Octokit } from "@octokit/rest";

/**
 * Build a draft changelog between two refs. Everything here is read-only: the
 * draft is returned to the caller and never written back to the repository.
 */
export async function draftNotes(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<string> {
  const compare = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${base}...${head}`,
  });

  const prNumbers = new Set<number>();
  for (const commit of compare.data.commits) {
    const match = /\(#(\d+)\)/.exec(commit.commit.message);
    if (match) prNumbers.add(Number(match[1]));
  }

  const lines: string[] = [];
  for (const number of prNumbers) {
    const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
    const author = pr.data.user?.login ?? "unknown";
    lines.push(`- ${pr.data.title} (#${number}) by @${author}`);
  }

  return lines.join("\n");
}
