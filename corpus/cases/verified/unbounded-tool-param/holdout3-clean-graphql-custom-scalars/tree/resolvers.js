const fs = require("node:fs/promises");
const path = require("node:path");
const { Duration, PageSize, RepoPath } = require("./scalars");

const ROOT = process.env.REPO_ROOT || "/srv/checkout";

const resolvers = {
  PageSize,
  RepoPath,
  Duration,

  Query: {
    // path and maxBytes arrive already coerced and bounded by the scalars.
    async readFile(_parent, { path: rel, maxBytes }) {
      const buffer = await fs.readFile(path.join(ROOT, rel));
      const slice = buffer.subarray(0, maxBytes);
      return {
        path: rel,
        text: slice.toString("utf8"),
        truncated: slice.length < buffer.length,
      };
    },

    async recentBuilds(_parent, { within, first }, ctx) {
      const since = new Date(Date.now() - within * 60_000);
      return ctx.builds.since(since, first);
    },
  },
};

module.exports = { resolvers };
