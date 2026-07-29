import { describe, it, expect, beforeEach } from "vitest";
import { MongoStore, COLLECTIONS, type MongoLike, type CollectionLike } from "../db/mongo-store.js";

/**
 * The MongoDB store, exercised against an in-memory fake of the driver.
 *
 * What this proves and what it does not: every filter, upsert and mapping decision in
 * `mongo-store.ts` is this file's business, and a live cluster's is that the driver behaves as
 * documented. Mixing the two would mean no test runs without a network, and the interesting
 * bugs — a `$set` that blanks a field, a Map that does not survive a round trip, a suppression
 * that is not applied — all live on this side of the line anyway.
 *
 * The fake implements MongoDB's *actual* semantics for the operators used, not convenient ones.
 * `$set` merges rather than replaces, `upsert` creates only when nothing matched, and a filter
 * with `$in` behaves like `$in`. A fake that is kinder than the real thing proves nothing.
 */

class FakeCollection implements CollectionLike {
  readonly docs = new Map<string, Record<string, unknown>>();

  private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([k, want]) => {
      const have = doc[k];
      if (want && typeof want === "object" && "$in" in (want as Record<string, unknown>)) {
        return ((want as { $in: unknown[] }).$in ?? []).includes(have);
      }
      return have === want;
    });
  }

  async findOne(filter: Record<string, unknown>) {
    for (const doc of this.docs.values()) if (this.matches(doc, filter)) return { ...doc } as never;
    return null;
  }

  find(filter: Record<string, unknown>) {
    const out = [...this.docs.values()].filter((d) => this.matches(d, filter)).map((d) => ({ ...d }));
    return { toArray: async () => out as never[] };
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) {
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [id, doc] of this.docs) {
      if (this.matches(doc, filter)) {
        // `$set` merges; it does not replace the document.
        this.docs.set(id, { ...doc, ...set });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    }
    if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0 };
    const id = String(filter._id ?? `gen-${this.docs.size}`);
    this.docs.set(id, { _id: id, ...set });
    return { matchedCount: 0, upsertedCount: 1 };
  }

  async deleteOne(filter: Record<string, unknown>) {
    for (const [id, doc] of this.docs) {
      if (this.matches(doc, filter)) {
        this.docs.delete(id);
        return { deletedCount: 1 };
      }
    }
    return { deletedCount: 0 };
  }

  async createIndex() {
    return "ok";
  }
}

class FakeDb implements MongoLike {
  readonly collections = new Map<string, FakeCollection>();
  collection<T = unknown>(name: string): CollectionLike<T> {
    let c = this.collections.get(name);
    if (!c) {
      c = new FakeCollection();
      this.collections.set(name, c);
    }
    return c as unknown as CollectionLike<T>;
  }
}

let db: FakeDb;
let store: MongoStore;

beforeEach(() => {
  db = new FakeDb();
  store = new MongoStore(db);
});

function scanDoc(id: string, findings: { fingerprint: string }[] = []) {
  return { scan: { id, rulesetVersion: "test" }, findings } as never;
}

describe("organizations", () => {
  it("round-trips an org", async () => {
    await store.upsertOrg({ id: "acme", planTier: "scale", llmEnabled: true, agentLoopEnabled: false });
    expect(await store.getOrg("acme")).toMatchObject({ id: "acme", planTier: "scale", llmEnabled: true });
  });

  it("does not blank the GitHub linkage on an upsert that does not mention it", async () => {
    await store.upsertOrg({
      id: "acme",
      planTier: "free",
      llmEnabled: true,
      agentLoopEnabled: false,
      githubOrgLogin: "acme",
      installationId: 7,
    });
    // A settings PATCH: same org, no GitHub fields.
    await store.upsertOrg({ id: "acme", planTier: "free", llmEnabled: false, agentLoopEnabled: true });

    /*
     * Blanking these would quietly turn a GitHub-backed tenant into a hand-made one, cutting off
     * the membership lookup that decides who may sign into it — a lockout that looks like a
     * settings change.
     */
    const org = await store.getOrg("acme");
    expect(org?.githubOrgLogin).toBe("acme");
    expect(org?.installationId).toBe(7);
    expect(org?.llmEnabled).toBe(false);
  });

  it("omits absent fields rather than reporting them as null", async () => {
    await store.upsertOrg({ id: "plain", planTier: "free", llmEnabled: true, agentLoopEnabled: false });
    const org = await store.getOrg("plain");
    // Absent means "no record of this", which every consumer already tests for. `null` would
    // read as a value.
    expect("githubOrgLogin" in (org ?? {})).toBe(false);
    expect("fixPrEnabled" in (org ?? {})).toBe(false);
  });

  it("finds orgs by GitHub login, and answers empty for an empty list", async () => {
    await store.upsertOrg({
      id: "acme",
      planTier: "free",
      llmEnabled: true,
      agentLoopEnabled: false,
      githubOrgLogin: "acme",
    });
    expect((await store.listOrgsByGithubLogin(["acme"])).map((o) => o.id)).toEqual(["acme"]);
    expect(await store.listOrgsByGithubLogin([])).toEqual([]);
  });
});

describe("scans and findings", () => {
  it("survives the round trip a Map cannot make through BSON", async () => {
    await store.putScan({
      id: "s1",
      orgId: "acme",
      doc: scanDoc("s1"),
      disputes: new Map([["fp-1", "not exploitable"]]),
      createdAt: "2026-01-01T00:00:00Z",
    });

    const back = await store.getScan("s1");
    // Stored as an object because BSON has no Map, and rebuilt as a Map because every caller
    // expects one.
    expect(back?.disputes).toBeInstanceOf(Map);
    expect(back?.disputes.get("fp-1")).toBe("not exploitable");
  });

  it("lists an org's scans oldest first, keeping undated ones", async () => {
    await store.putScan({ id: "b", orgId: "acme", doc: scanDoc("b"), disputes: new Map(), createdAt: "2026-02-01" });
    await store.putScan({ id: "a", orgId: "acme", doc: scanDoc("a"), disputes: new Map(), createdAt: "2026-01-01" });
    await store.putScan({ id: "old", orgId: "acme", doc: scanDoc("old"), disputes: new Map() });
    await store.putScan({ id: "other", orgId: "beta", doc: scanDoc("other"), disputes: new Map() });

    // A scan written before `createdAt` existed is still a scan; dropping it would lose history.
    expect((await store.listScans("acme")).map((s) => s.id)).toEqual(["old", "a", "b"]);
  });

  it("hides a suppressed finding, and shows it again when asked", async () => {
    await store.putScan({
      id: "s1",
      orgId: "acme",
      doc: scanDoc("s1", [{ fingerprint: "keep" }, { fingerprint: "disputed" }]),
      disputes: new Map(),
    });
    await store.suppress("acme", "disputed");

    expect((await store.findingsOf("s1")).map((f) => f.fingerprint)).toEqual(["keep"]);
    expect((await store.findingsOf("s1", true)).map((f) => f.fingerprint)).toEqual(["keep", "disputed"]);
    expect(await store.isSuppressed("acme", "disputed")).toBe(true);
    // Suppression is org-scoped: another tenant disputing nothing sees everything.
    expect(await store.isSuppressed("beta", "disputed")).toBe(false);
  });

  it("returns nothing for a scan that does not exist, rather than throwing", async () => {
    expect(await store.findingsOf("nope")).toEqual([]);
    expect(await store.getScan("nope")).toBeUndefined();
  });
});

describe("repositories", () => {
  const repo = {
    orgId: "acme",
    name: "acme/api",
    source: "github" as const,
    frameworks: [],
    gateMode: "off" as const,
    gateFailureMode: "fail_open" as const,
    agentLoopEnabled: false,
    connectedAt: "2026-01-01T00:00:00Z",
  };

  it("keeps settings and history when an already-connected repo is connected again", async () => {
    await store.connectRepo(repo);
    await store.updateRepo("acme", "acme/api", { gateMode: "block_verified" });
    await store.putRepo("acme", "acme/api", "scan-1", { frameworks: ["next"] });

    // Connecting is idempotent. Resetting a gate policy or discarding scan history because
    // somebody clicked connect twice would be a data-loss bug wearing a no-op's clothes.
    await store.connectRepo({ ...repo, visibility: "private" });

    const back = await store.getRepo("acme", "acme/api");
    expect(back?.gateMode).toBe("block_verified");
    expect(back?.lastScanId).toBe("scan-1");
    expect(back?.frameworks).toEqual(["next"]);
    expect(back?.visibility).toBe("private");
  });

  it("never writes an explicit undefined over a field GitHub did not report", async () => {
    await store.connectRepo(repo);
    await store.putRepo("acme", "acme/api", "scan-1", { frameworks: ["next"] });

    /*
     * `$set: { visibility: undefined }` writes a null in some driver versions, recording "we
     * asked GitHub and it is nothing" where the truth is "we do not know" — the exact
     * distinction that stops the dashboard printing "Private" beside a public repository.
     */
    const raw = db.collections.get(COLLECTIONS.repos)!.docs.get(["acme", "acme/api"].join("\u0000"))!;
    expect("visibility" in raw).toBe(false);
  });

  it("scopes repositories to their org, and reports a delete honestly", async () => {
    await store.connectRepo(repo);
    await store.connectRepo({ ...repo, orgId: "beta", name: "beta/site" });

    expect((await store.getRepos("acme")).map((r) => r.name)).toEqual(["acme/api"]);
    expect(await store.deleteRepo("acme", "acme/api")).toBe(true);
    expect(await store.deleteRepo("acme", "acme/api")).toBe(false);
  });

  it("returns undefined rather than inventing a record for an unknown repo", async () => {
    expect(await store.updateRepo("acme", "nope", { gateMode: "off" })).toBeUndefined();
  });
});

describe("session revocation", () => {
  it("reports a token revoked until its own expiry, and not after", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.revokeSession("jti-1", future);
    expect(await store.isSessionRevoked("jti-1")).toBe(true);

    /*
     * The TTL index sweeps about once a minute, so a row can outlive its expiry by that much.
     * Checking the timestamp here means a stale row never *under*-reports — and past the expiry
     * the signature check refuses the token anyway.
     */
    await store.revokeSession("jti-2", Math.floor(Date.now() / 1000) - 10);
    expect(await store.isSessionRevoked("jti-2")).toBe(false);
    expect(await store.isSessionRevoked("never-issued")).toBe(false);
  });

  it("stores the expiry as a Date, which is what the TTL index reads", async () => {
    await store.revokeSession("jti-1", Math.floor(Date.now() / 1000) + 60);
    const raw = db.collections.get(COLLECTIONS.revokedSessions)!.docs.get("jti-1")!;
    // Stored as a string, Mongo would keep the row forever — a revocation list nobody prunes.
    expect(raw.expiresAt).toBeInstanceOf(Date);
  });

  it("is idempotent — revoking twice is revoking once", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    await store.revokeSession("jti-1", exp);
    await store.revokeSession("jti-1", exp);
    expect(db.collections.get(COLLECTIONS.revokedSessions)!.docs.size).toBe(1);
  });
});

describe("GitHub access grants", () => {
  it("keeps the stored token when a refresh supplies only a new grant", async () => {
    await store.putUserAccess({
      githubUserId: "1",
      login: "octocat",
      grant: { orgs: [] },
      accessToken: "gho_x",
      refreshedAt: "a",
    });
    await store.putUserAccess({ githubUserId: "1", login: "octocat", grant: { orgs: ["acme"] }, refreshedAt: "b" });

    // A refresh has a new grant but no new token. Blanking it would silently freeze that user's
    // access at whatever was last cached until they signed in again.
    const back = await store.getUserAccess("1");
    expect(back?.accessToken).toBe("gho_x");
    expect(back?.refreshedAt).toBe("b");
  });

  it("forgets the grant and the token together", async () => {
    await store.putUserAccess({
      githubUserId: "1",
      login: "octocat",
      grant: {},
      accessToken: "gho_x",
      refreshedAt: "a",
    });
    await store.deleteUserAccess("1");
    expect(await store.getUserAccess("1")).toBeUndefined();
  });
});

describe("local password accounts", () => {
  const account = { login: "Admin", passwordHash: "scrypt.32768.8.1.aa.bb", role: "admin" as const };

  it("looks an account up however the login is capitalised", async () => {
    await store.putLocalAccount(account);
    // Keyed on the lower-cased login, so "Admin" and "admin" are one account — and nobody can
    // create a near-duplicate of an existing one by changing a letter's case.
    expect((await store.getLocalAccount("admin"))?.role).toBe("admin");
    expect((await store.getLocalAccount("ADMIN"))?.login).toBe("Admin");
    expect(await store.getLocalAccount("someone-else")).toBeUndefined();
  });

  it("overwrites rather than duplicating when the same login is written again", async () => {
    await store.putLocalAccount(account);
    await store.putLocalAccount({ ...account, login: "admin", passwordHash: "scrypt.32768.8.1.cc.dd", role: "viewer" });

    const all = await store.listLocalAccounts();
    expect(all).toHaveLength(1);
    expect(all[0]!.role).toBe("viewer");
  });

  it("never stores a plaintext password — only what it was given", async () => {
    await store.putLocalAccount(account);
    const raw = db.collections.get(COLLECTIONS.accounts)!.docs.get("admin")!;
    expect(raw.passwordHash).toBe("scrypt.32768.8.1.aa.bb");
    expect(JSON.stringify(raw)).not.toMatch(/password"\s*:\s*"(?!scrypt)/);
  });

  it("deletes, and reports whether there was anything to delete", async () => {
    await store.putLocalAccount(account);
    expect(await store.deleteLocalAccount("ADMIN")).toBe(true);
    expect(await store.deleteLocalAccount("ADMIN")).toBe(false);
  });
});

describe("benchmark and compliance", () => {
  it("appends runs to a corpus version rather than replacing them", async () => {
    await store.publishBenchmark("corpus-v1", "gatepass", JSON.stringify({ tool: "gatepass" }));
    await store.publishBenchmark("corpus-v1", "semgrep", JSON.stringify({ tool: "semgrep" }));

    // The benchmark is a comparison. A second tool's run replacing the first would leave a
    // chart with one bar and no way to notice.
    const rec = (await store.getBenchmark("corpus-v1")) as { runs: { tool: string }[] };
    expect(rec.runs.map((r) => r.tool)).toEqual(["gatepass", "semgrep"]);
  });

  it("answers null for an unpublished version and a list for no version", async () => {
    expect(await store.getBenchmark("nothing-here")).toBeNull();
    expect(await store.getBenchmark()).toEqual([]);
  });

  it("round-trips a compliance scan", async () => {
    await store.putComplianceScan("cmp-1", "acme", { checks: 5 });
    expect(await store.getComplianceScan("cmp-1")).toMatchObject({ scanId: "cmp-1", orgId: "acme" });
  });
});

describe("indexes", () => {
  it("declares a TTL index so revocations prune themselves", async () => {
    const created: Record<string, unknown>[] = [];
    const spy = new FakeDb();
    const original = spy.collection.bind(spy);
    spy.collection = ((name: string) => {
      const col = original(name);
      return {
        ...col,
        createIndex: async (spec: Record<string, unknown>, options?: Record<string, unknown>) => {
          created.push({ name, spec, options });
          return "ok";
        },
      } as never;
    }) as never;

    await new MongoStore(spy).ensureIndexes();

    /*
     * The Postgres schema needs a periodic DELETE that nothing currently runs. Here the database
     * does it — which is the one place this store is straightforwardly better than that one.
     */
    const ttl = created.find((c) => c.name === COLLECTIONS.revokedSessions);
    expect(ttl?.options).toMatchObject({ expireAfterSeconds: 0 });
  });
});
