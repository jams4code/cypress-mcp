// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import path from "node:path";
import { platform } from "node:os";

const IS_WINDOWS = platform() === "win32";

/** Normalize path separators to forward slashes */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Resolve and normalize a path relative to a base directory */
export function resolvePath(base: string, ...segments: string[]): string {
  return normalizePath(path.resolve(base, ...segments));
}

/** Get relative path from base, normalized */
export function relativePath(from: string, to: string): string {
  return normalizePath(path.relative(from, to));
}

/** Resolve the Cypress binary path for the given project */
export function resolveCypressBin(projectRoot: string): string {
  const localBin = IS_WINDOWS
    ? path.join(projectRoot, "node_modules", ".bin", "cypress.cmd")
    : path.join(projectRoot, "node_modules", ".bin", "cypress");
  return localBin;
}

/** Check if we need shell:true for spawning (Windows .cmd files) */
export function needsShell(binPath: string): boolean {
  return IS_WINDOWS && binPath.endsWith(".cmd");
}

export { IS_WINDOWS };
