// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { createRequire } from "node:module";

/** Normalize path separators to forward slashes */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve `candidate` against `root` and return the absolute path, or null
 * when it escapes the root (via `..` or an absolute path elsewhere).
 */
export function resolveInsideRoot(root: string, candidate: string): string | null {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absolute);

  const escapes =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return escapes ? null : absolute;
}

export interface CypressInstall {
  /** Absolute path of the CLI entry script (`cypress/bin/cypress`) */
  readonly cli: string;
  /** Version of the installed `cypress` npm package */
  readonly version: string;
}

/**
 * Find the project's Cypress install the way Node resolves modules from the
 * project, so hoisted installs in monorepos work. The CLI script is run with
 * `process.execPath`, which needs no shell on any platform. Returns null when
 * Cypress is not installed for the project.
 */
export function resolveCypressInstall(projectRoot: string): CypressInstall | null {
  try {
    const require = createRequire(path.join(path.resolve(projectRoot), "package.json"));
    const pkgJsonPath = require.resolve("cypress/package.json");
    const pkg = require(pkgJsonPath) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    const binEntry =
      typeof pkg.bin === "string" ? pkg.bin : (pkg.bin?.["cypress"] ?? "bin/cypress");
    return {
      cli: path.join(path.dirname(pkgJsonPath), binEntry),
      version: pkg.version ?? "0.0.0",
    };
  } catch {
    return null;
  }
}

/** True when `version` (x.y.z) is at least `major.minor`. */
export function isVersionAtLeast(version: string, major: number, minor: number): boolean {
  const [maj = 0, min = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return maj > major || (maj === major && min >= minor);
}
