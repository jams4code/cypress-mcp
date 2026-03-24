// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "key",
  "apikey",
  "api_key",
  "auth",
  "credential",
  "private",
  "session",
  "cookie",
  "jwt",
  "bearer",
  "access_token",
  "refresh_token",
  "client_secret",
]);

/** Check if a key name looks like it holds a secret */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return Array.from(SENSITIVE_KEYS).some((s) => lower.includes(s));
}

/** Mask sensitive values in an object, returning a new object */
export function sanitizeEnv(
  env: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSensitiveKey(key) && typeof value === "string") {
      result[key] = value.length > 4 ? value.slice(0, 2) + "***" + value.slice(-2) : "***";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeEnv(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
