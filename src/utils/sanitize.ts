// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

/** Type of a cypress.env.json value, or the shape of a nested object. */
export type EnvShape =
  "string" | "number" | "boolean" | "null" | "array" | EnvObjectShape;

export interface EnvObjectShape {
  readonly [key: string]: EnvShape;
}

const MAX_DEPTH = 10;

/**
 * Keys of a cypress.env.json object with the type of each value. Values are
 * never returned: masking by key name missed secrets stored under keys such as
 * `adminPass` or inside URLs, and partial masks still leaked characters.
 */
export function describeEnv(
  env: Readonly<Record<string, unknown>>,
  depth = 0,
): EnvObjectShape {
  const result: Record<string, EnvShape> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = describeValue(value, depth);
  }
  return result;
}

function describeValue(value: unknown, depth: number): EnvShape {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") {
    return depth >= MAX_DEPTH
      ? {}
      : describeEnv(value as Record<string, unknown>, depth + 1);
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}
