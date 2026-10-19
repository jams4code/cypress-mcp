// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { glob } from "tinyglobby";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath, resolveInsideRoot } from "../utils/paths.js";
import { SpecNotFoundError, SpecOutsideProjectError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

export class SpecFinder {
  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
  ) {}

  /** Find all spec files matching the pattern */
  async findSpecs(pattern?: string | readonly string[]): Promise<string[]> {
    const searchPatterns = pattern
      ? Array.isArray(pattern)
        ? [...pattern]
        : [pattern]
      : ["cypress/e2e/**/*.cy.{ts,js,tsx,jsx}"];
    const files = await glob(searchPatterns, {
      cwd: this.projectRoot,
      absolute: false,
    });

    const sorted = files.map(normalizePath).sort();
    this.logger.debug("Found specs", { count: sorted.length, pattern: searchPatterns });
    return sorted;
  }

  /**
   * Verify a spec file exists inside the project and return its path relative
   * to the project root, with forward slashes. Rejects paths that escape the root.
   */
  async resolveSpec(spec: string): Promise<string> {
    const absolute = resolveInsideRoot(this.projectRoot, spec);
    if (!absolute) {
      throw new SpecOutsideProjectError(spec);
    }

    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) {
        throw new SpecNotFoundError(spec);
      }
    } catch {
      throw new SpecNotFoundError(spec);
    }

    return normalizePath(path.relative(path.resolve(this.projectRoot), absolute));
  }

  /** Count tests in a spec file using regex (no AST parsing) */
  async countTests(specPath: string): Promise<number> {
    const absolute = path.isAbsolute(specPath)
      ? specPath
      : path.join(this.projectRoot, specPath);

    try {
      const content = await fs.readFile(absolute, "utf-8");
      const itMatches = content.match(/\bit\s*\(/g);
      const itDotMatches = content.match(/\bit\.(only|skip)\s*\(/g);
      return (itMatches?.length ?? 0) + (itDotMatches?.length ?? 0);
    } catch {
      return 0;
    }
  }
}
