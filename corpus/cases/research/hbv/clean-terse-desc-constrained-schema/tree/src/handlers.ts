export type User = { id: string; name: string; email: string; orgId: string };
export type Org = { id: string; name: string; plan: "free" | "team" | "enterprise" };

/** Snapshot of the directory, refreshed by a nightly sync job. */
const USERS = new Map<string, User>([
  [
    "usr_01hq9m2n4p6r8t0v2x4z6b8d0f",
    {
      id: "usr_01hq9m2n4p6r8t0v2x4z6b8d0f",
      name: "Dana Okafor",
      email: "dana@example.com",
      orgId: "org_01hq9m2n4p6r8t0v2x4z6b8d0f",
    },
  ],
]);

const ORGS = new Map<string, Org>([
  [
    "org_01hq9m2n4p6r8t0v2x4z6b8d0f",
    { id: "org_01hq9m2n4p6r8t0v2x4z6b8d0f", name: "Example Inc", plan: "team" },
  ],
]);

/** Single-record read. There is no list, search, or write path in this module. */
export async function getUser(userId: string): Promise<User | null> {
  return USERS.get(userId) ?? null;
}

export async function getOrg(orgId: string): Promise<Org | null> {
  return ORGS.get(orgId) ?? null;
}
