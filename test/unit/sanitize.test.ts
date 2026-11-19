import { describe, it, expect } from "vitest";
import { describeEnv } from "../../src/utils/sanitize.js";

describe("describeEnv", () => {
  // Values cypress_get_env returned in clear in 0.2.1, under keys the old
  // name-based mask did not cover, plus ones it only partly masked.
  const env = {
    baseUrl: "https://alice:p4ssw0rd@staging.example.com",
    adminPass: "hunter2-admin",
    dbPwd: "s3cr3t-db",
    stripe: "sk_live_51HxYzAbCdEf",
    API_KEY: "sk-1234567890abcdef",
    retries: 2,
    headless: true,
    proxy: null,
    users: ["first@example.com"],
    auth: { password: "secret123", username: "root-user" },
  };

  it("returns every key with the type of its value", () => {
    expect(describeEnv(env)).toEqual({
      baseUrl: "string",
      adminPass: "string",
      dbPwd: "string",
      stripe: "string",
      API_KEY: "string",
      retries: "number",
      headless: "boolean",
      proxy: "null",
      users: "array",
      auth: { password: "string", username: "string" },
    });
  });

  it("never returns any part of a value", () => {
    const text = JSON.stringify(describeEnv(env));
    const fragments = [
      "alice",
      "p4ssw0rd",
      "hunter2",
      "s3cr3t",
      "sk_live",
      "sk-12",
      "secret123",
      "root-user",
      "first@",
    ];

    for (const fragment of fragments) {
      expect(text).not.toContain(fragment);
    }
  });

  it("stops descending into deeply nested objects", () => {
    let nested: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 20; i++) nested = { inner: nested };

    expect(() => JSON.stringify(describeEnv(nested))).not.toThrow();
  });
});
