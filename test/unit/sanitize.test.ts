import { describe, it, expect } from "vitest";
import { sanitizeEnv } from "../../src/utils/sanitize.js";

describe("sanitizeEnv", () => {
  it("should mask sensitive values", () => {
    const env = {
      API_KEY: "sk-1234567890abcdef",
      BASE_URL: "https://example.com",
      SECRET_TOKEN: "mytoken123",
    };

    const result = sanitizeEnv(env);

    expect(result["API_KEY"]).toContain("***");
    expect(result["API_KEY"]).not.toBe("sk-1234567890abcdef");
    expect(result["BASE_URL"]).toBe("https://example.com");
    expect(result["SECRET_TOKEN"]).toContain("***");
  });

  it("should preserve non-sensitive values", () => {
    const env = { NODE_ENV: "test", PORT: "3000" };
    const result = sanitizeEnv(env);

    expect(result["NODE_ENV"]).toBe("test");
    expect(result["PORT"]).toBe("3000");
  });

  it("should handle nested objects", () => {
    const env = {
      auth: { password: "secret123", username: "admin" },
    };

    const result = sanitizeEnv(env);
    const auth = result["auth"] as Record<string, unknown>;

    expect(auth["password"]).toContain("***");
    expect(auth["username"]).toBe("admin");
  });

  it("should handle short sensitive values", () => {
    const env = { API_KEY: "ab" };
    const result = sanitizeEnv(env);

    expect(result["API_KEY"]).toBe("***");
  });
});
