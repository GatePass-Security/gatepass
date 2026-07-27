import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";

/**
 * PATCH /v1/orgs/:org/settings.
 *
 * The dashboard's settings toggles previously called this path against a router
 * that had no PATCH branch at all, so every save 404'd while the UI reported
 * success. These tests pin the route down: that it persists, that it is a true
 * partial update, and that it cannot be used to widen what an org may write.
 */

let base: string;
let close: () => void;

beforeAll(async () => {
  const { server } = await createServer({ seedBenchmark: false });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  close = () => server.close();
});

afterAll(() => close());

async function patch(path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(path: string) {
  const res = await fetch(base + path);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("PATCH /v1/orgs/:org/settings", () => {
  it("persists llm_analysis_enabled and returns the updated org", async () => {
    const before = await get("/v1/orgs/demo");
    expect(before.json.llmEnabled).toBe(true);

    const res = await patch("/v1/orgs/demo/settings", { llm_analysis_enabled: false });
    expect(res.status).toBe(200);
    expect(res.json.llmEnabled).toBe(false);

    // Survives the round trip — the dashboard reconciles against this read.
    const after = await get("/v1/orgs/demo");
    expect(after.json.llmEnabled).toBe(false);
  });

  it("is a partial update: an absent field is left untouched", async () => {
    await patch("/v1/orgs/demo/settings", { llm_analysis_enabled: true, agent_loop_enabled: true });
    const res = await patch("/v1/orgs/demo/settings", { agent_loop_enabled: false });

    expect(res.json.agentLoopEnabled).toBe(false);
    expect(res.json.llmEnabled).toBe(true);
  });

  it("ignores non-boolean values rather than coercing them", async () => {
    await patch("/v1/orgs/demo/settings", { llm_analysis_enabled: true });
    const res = await patch("/v1/orgs/demo/settings", { llm_analysis_enabled: "false" });

    expect(res.json.llmEnabled).toBe(true);
  });

  it("ignores unknown keys — a malformed body cannot widen what is written", async () => {
    const res = await patch("/v1/orgs/demo/settings", { planTier: "scale", id: "attacker", role: "admin" });

    expect(res.status).toBe(200);
    expect(res.json.id).toBe("demo");
    expect(res.json.planTier).toBe("scale");

    const after = await get("/v1/orgs/demo");
    expect(after.json.id).toBe("demo");
  });

  it("cannot escalate plan tier", async () => {
    const res = await patch("/v1/orgs/free-org/settings", { planTier: "scale", llm_analysis_enabled: false });

    expect(res.json.planTier).toBe("free");
    expect(res.json.llmEnabled).toBe(false);
  });

  it("404s for an unknown org", async () => {
    const res = await patch("/v1/orgs/does-not-exist/settings", { llm_analysis_enabled: true });
    expect(res.status).toBe(404);
  });
});
