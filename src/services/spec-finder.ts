// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { glob } from "tinyglobby";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath, resolveInsideRoot } from "../utils/paths.js";
import { parseSpec, type ParsedSpec } from "./spec-parser.js";
import {
  InvalidArgumentError,
  SpecNotFoundError,
  SpecOutsideProjectError,
} from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";

const MAX_GLOB_LENGTH = 1024;
// +(..) @(..) !(..) *(..) ?(..): the extglob forms behind picomatch ReDoS
// advisories such as GHSA-fc5q-39xc-vjpf. Spec patterns never need them.
const EXTGLOB_GROUP = /[+@!*?]\(/;

/**
 * Guard for glob patterns that come from a tool caller rather than the
 * project's own Cypress config. Throws InvalidArgumentError when the pattern
 * uses extglob groups or is unreasonably long.
 */
export function assertPlainGlob(pattern: string): void {
  if (pattern.length > MAX_GLOB_LENGTH) {
    throw new InvalidArgumentError(
      `Glob pattern is too long (${pattern.length} characters, max ${MAX_GLOB_LENGTH}).`,
    );
  }
  if (EXTGLOB_GROUP.test(pattern)) {
    throw new InvalidArgumentError(
      "Extended glob groups such as +(a|b) are not supported. Use braces, for example {a,b}.",
    );
  }
}

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

  /** Parse the describe/it structure of a spec, or null when it cannot be read. */
  async parse(specPath: string): Promise<ParsedSpec | null> {
    const absolute = path.isAbsolute(specPath)
      ? specPath
      : path.join(this.projectRoot, specPath);

    try {
      return parseSpec(await fs.readFile(absolute, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Count the tests declared in a spec, with the same parser as discovery. */
  async countTests(specPath: string): Promise<number> {
    return (await this.parse(specPath))?.tests.length ?? 0;
  }
}
