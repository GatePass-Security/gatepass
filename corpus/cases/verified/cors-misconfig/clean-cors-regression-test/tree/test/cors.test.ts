import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../src/app";

const ORIGIN_HEADER = "access-control-allow-origin";
const CREDENTIALS_HEADER = "access-control-allow-credentials";

describe("CORS policy", () => {
  it("never answers with a wildcard origin", async () => {
    const res = await request(app).get("/api/profile").set("Origin", "https://evil.example");
    expect(res.headers[ORIGIN_HEADER]).not.toBe("*");
    expect(res.headers[ORIGIN_HEADER]).not.toBe("https://evil.example");
  });

  it("never pairs Access-Control-Allow-Origin: * with credentials", async () => {
    const res = await request(app).get("/api/profile").set("Origin", "https://app.acme.com");
    const forbidden = res.headers[ORIGIN_HEADER] === "*" && res.headers[CREDENTIALS_HEADER] === "true";
    expect(forbidden).toBe(false);
  });

  it("echoes only the dashboard origin", async () => {
    const res = await request(app).get("/api/profile").set("Origin", "https://app.acme.com");
    expect(res.headers[ORIGIN_HEADER]).toBe("https://app.acme.com");
    expect(res.headers[CREDENTIALS_HEADER]).toBe("true");
  });

  it("does not treat a lookalike origin as trusted", async () => {
    const res = await request(app).get("/api/profile").set("Origin", "https://app.acme.com.evil.io");
    expect(res.headers[ORIGIN_HEADER]).not.toBe("https://app.acme.com.evil.io");
  });
});
