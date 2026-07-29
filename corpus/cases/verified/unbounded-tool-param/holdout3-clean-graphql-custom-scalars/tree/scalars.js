const { GraphQLScalarType, GraphQLError } = require("graphql");

// Every path into the executor - variables and inline literals - runs check.
const bounded = (name, check) =>
  new GraphQLScalarType({
    name,
    serialize: (value) => value,
    parseValue: (value) => check(value),
    parseLiteral: (node) => check(node.value),
  });

const PageSize = bounded("PageSize", (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new GraphQLError("PageSize must be an integer between 1 and 1000");
  }
  return n;
});

const RepoPath = bounded("RepoPath", (value) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    !/^[\w.\-/]+$/.test(value) ||
    value.split("/").includes("..")
  ) {
    throw new GraphQLError("RepoPath must be a bounded repo-relative path");
  }
  return value;
});

const Duration = bounded("Duration", (value) => {
  const match = /^(\d{1,3})([mh])$/.exec(String(value));
  if (!match) {
    throw new GraphQLError("Duration must look like 30m or 12h");
  }
  const minutes = match[2] === "h" ? Number(match[1]) * 60 : Number(match[1]);
  if (minutes < 1 || minutes > 168 * 60) {
    throw new GraphQLError("Duration must be between 1m and 168h");
  }
  return minutes;
});

module.exports = { PageSize, RepoPath, Duration };
