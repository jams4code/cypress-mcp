// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// What a run should run, from the `spec` argument: one spec, several, a glob
// such as cypress/e2e/**/*.cy.ts, or `file:line` to run the test (or the
// describe block) at that line. Everything runs in one Cypress launch.
import { existsSync } from "node:fs";
import path from "node:path";
import type { ToolContext } from "../types/index.js";
import type { ParsedSpec, ParsedSuite } from "./spec-parser.js";
import { assertPlainGlob } from "./spec-finder.js";
import { InvalidArgumentError, SpecNotFoundError } from "../utils/errors.js";

export interface RunTargets {
  /** Spec files, project relative, forward slashes */
  readonly specs: readonly string[];
  /** Value for `cypress run --spec` */
  readonly cypressSpec: string;
  /** Exact full titles, when the targets were file:line */
  readonly titles?: readonly string[];
}

const GLOB_CHARS = /[*?[\]{}]/;
const FILE_LINE = /^(.+?):(\d+)(?::\d+)?$/;

/** Upper bound for one launch; a bigger suite should go through a glob in CI. */
const MAX_SPECS = 500;

export async function resolveTargets(
  ctx: ToolContext,
  inputs: readonly string[],
): Promise<RunTargets> {
  if (inputs.length === 0) {
    throw new InvalidArgumentError(
      "spec is required: a spec path, file:line, or a glob.",
    );
  }

  const specs: string[] = [];
  const titles: string[] = [];
  let globs = 0;
  let lineTargets = 0;

  for (const raw of inputs) {
    const input = raw.trim();
    const lineMatch = FILE_LINE.exec(input);

    if (lineMatch && !existsSync(path.resolve(ctx.projectRoot, input))) {
      const spec = await ctx.specFinder.resolveSpec(lineMatch[1]!);
      const line = Number(lineMatch[2]);
      const parsed = await ctx.specFinder.parse(spec);
      const found = parsed ? titlesAtLine(parsed, line) : [];
      if (found.length === 0) {
        throw new InvalidArgumentError(
          `No test or describe block starts at or before line ${line} of ${spec}. Pass the line of an it() or describe() call, or the spec alone.`,
        );
      }
      specs.push(spec);
      titles.push(...found);
      lineTargets++;
    } else if (
      GLOB_CHARS.test(input) &&
      !existsSync(path.resolve(ctx.projectRoot, input))
    ) {
      assertPlainGlob(input);
      if (path.isAbsolute(input) || input.split(/[\\/]/).includes("..")) {
        throw new InvalidArgumentError(
          `Globs must be relative to the project root and stay inside it: ${input}`,
        );
      }
      const matched = await ctx.specFinder.findSpecs(input);
      if (matched.length === 0) {
        throw new SpecNotFoundError(input);
      }
      specs.push(...matched);
      globs++;
    } else {
      specs.push(await ctx.specFinder.resolveSpec(input));
    }
  }

  if (lineTargets > 0 && lineTargets < inputs.length) {
    throw new InvalidArgumentError(
      "file:line targets cannot be mixed with whole specs or globs in one run: run them separately.",
    );
  }

  const unique = [...new Set(specs)];
  if (unique.length > MAX_SPECS) {
    throw new InvalidArgumentError(
      `${unique.length} specs match, more than ${MAX_SPECS} in one run. Narrow the glob.`,
    );
  }
  // Cypress splits --spec on commas, so a listed path cannot contain one.
  if (unique.length > 1 && unique.some((spec) => spec.includes(","))) {
    throw new InvalidArgumentError(
      "A spec path with a comma can only run on its own: Cypress splits --spec on commas.",
    );
  }

  return {
    specs: unique,
    // A single glob goes to Cypress as written, which keeps the command line
    // short for big suites; Cypress expands it relative to the project root.
    cypressSpec:
      globs === 1 && inputs.length === 1 ? inputs[0]!.trim() : unique.join(","),
    ...(titles.length > 0 ? { titles: [...new Set(titles)] } : {}),
  };
}

/**
 * Full titles of the test at `line`: the innermost it() or describe() that
 * starts at or before the line. A describe gives all its tests. Exported for
 * tests.
 */
export function titlesAtLine(parsed: ParsedSpec, line: number): string[] {
  type Block = { line: number; titles: () => string[] };
  const blocks: Block[] = [
    ...parsed.tests.map((test) => ({ line: test.line, titles: () => [test.fullTitle] })),
    ...parsed.suites.map((suite) => ({ line: suite.line, titles: () => testsIn(suite) })),
  ];
  // The latest start at or before the line; on a tie (same line), the test.
  const best = blocks
    .filter((block) => block.line > 0 && block.line <= line)
    .sort((a, b) => b.line - a.line)[0];
  return best ? best.titles() : [];
}

function testsIn(suite: ParsedSuite): string[] {
  return [...suite.tests.map((test) => test.fullTitle), ...suite.suites.flatMap(testsIn)];
}
