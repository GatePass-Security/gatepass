import { Octokit } from "@octokit/rest";

export async function review(octokit: Octokit, owner: string, repo: string, pull_number: number) {
  const files = await octokit.rest.pulls.listFiles({ owner, repo, pull_number, per_page: 100 });

  const comments = files.data
    .filter((f) => f.filename.endsWith(".ts") && (f.additions ?? 0) > 300)
    .map((f) => ({
      path: f.filename,
      body: "Large diff in a single file - consider splitting this change.",
      line: 1,
    }));

  if (comments.length === 0) return { posted: 0 };

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: "COMMENT",
    body: "Automated review from pr-reviewer.",
    comments,
  });

  return { posted: comments.length };
}
