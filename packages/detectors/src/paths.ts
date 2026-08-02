/**
 * Path predicates shared by detectors.
 *
 * `TEST_PATH` lived in `tool-params.ts` and was needed verbatim by `unauth-mcp-transport.ts` the
 * moment host resolution had to tell production code from a fixture. Copying it a third time
 * (the research survey has its own) is how two of them drift apart, so it lives here now.
 */

/** Test, spec, fixture and example code — present in the tree, but not what the service does. */
export const TEST_PATH =
  /(?:^|\/)(?:tests?|__tests__|spec|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\.[jt]sx?$|_test\.py$/i;
