// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { glob } from "tinyglobby";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "../utils/paths.js";
import { SpecNotFoundError } from "../utils/errors.js";
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

  /** Verify a spec file exists and return its absolute path */
  async resolveSpec(spec: string): Promise<string> {
    const absolute = path.isAbsolute(spec)
      ? spec
      : path.join(this.projectRoot, spec);

    try {
      await fs.access(absolute);
      return normalizePath(absolute);
    } catch {
      throw new SpecNotFoundError(spec);
    }
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
