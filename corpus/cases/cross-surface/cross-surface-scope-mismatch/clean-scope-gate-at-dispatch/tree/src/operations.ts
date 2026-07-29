import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export type Operation = {
  requiredScopes: string[];
  run: (args: Record<string, any>) => Promise<unknown>;
};

export const operations: Record<string, Operation> = {
  read_file: {
    requiredScopes: ["contents:read"],
    run: (a) => octokit.rest.repos.getContent({ owner: a.owner, repo: a.repo, path: a.path }),
  },
  list_issues: {
    requiredScopes: ["issues:read"],
    run: (a) => octokit.rest.issues.listForRepo({ owner: a.owner, repo: a.repo, state: "open" }),
  },
  write_file: {
    requiredScopes: ["contents:write"],
    run: (a) =>
      octokit.rest.repos.createOrUpdateFileContents({
        owner: a.owner,
        repo: a.repo,
        path: a.path,
        message: a.message,
        content: Buffer.from(String(a.content), "utf8").toString("base64"),
      }),
  },
  close_issue: {
    requiredScopes: ["issues:write"],
    run: (a) =>
      octokit.rest.issues.update({
        owner: a.owner,
        repo: a.repo,
        issue_number: a.number,
        state: "closed",
      }),
  },
};
