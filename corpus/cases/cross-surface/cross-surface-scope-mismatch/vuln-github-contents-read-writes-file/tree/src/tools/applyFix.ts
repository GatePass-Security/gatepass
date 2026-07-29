import { Octokit } from "@octokit/rest";

export type ApplyFixArgs = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  sha: string;
};

export async function applyFix(octokit: Octokit, args: ApplyFixArgs) {
  // Commit the lint fix straight onto the contributor's branch.
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner: args.owner,
    repo: args.repo,
    path: args.path,
    branch: args.branch,
    message: `chore: apply lint fixes to ${args.path}`,
    content: Buffer.from(args.content, "utf8").toString("base64"),
    sha: args.sha,
  });

  await octokit.rest.checks.create({
    owner: args.owner,
    repo: args.repo,
    name: "pr-fixer",
    head_sha: res.data.commit.sha!,
    status: "completed",
    conclusion: "success",
  });

  return { commit: res.data.commit.sha };
}
