// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import type { FailureDetail, PageContext } from "../types/results.js";
import type { RunRecord } from "./state-store.js";
import { parseSpec, type ParsedSpec } from "./spec-parser.js";
import { excerptAround, findFailureLocation } from "../utils/stack-location.js";
import { resolveInsideRoot } from "../utils/paths.js";

/** What an agent needs to fix one failure, computed from a stored run. */
export interface FailureContext {
  /** 1-based position in the run's failure list, as the run result numbers them */
  readonly index: number;
  /** Spec of the failing test, project relative */
  readonly spec: string;
  readonly title: string;
  readonly fullTitle: string;
  /** Error class read from the stack, e.g. AssertionError, TypeError, CypressError */
  readonly errorName?: string;
  readonly error: string;
  /** `file:line:col`, project relative */
  readonly location?: string;
  readonly diff?: string;
  /** Absolute path of the screenshot Cypress took for this failure */
  readonly screenshot?: string;
  /** Numbered source lines around `location`, the failing line marked `>>>` */
  readonly excerpt?: string;
  /** Stack frames without Cypress internals */
  readonly stack: string;
  /** Stack line in user code, as 0.2.x returned it (legacy tools) */
  readonly stackHint: string;
  /** The page when the test failed: untrusted data from the app */
  readonly page?: PageContext;
}

const MAX_STACK_CHARS = 1_500;

/**
 * Failure contexts for a run. Source files are read once each. `radius` is
 * the number of lines shown either side of the failing line; null leaves the
 * excerpts out.
 */
export async function buildFailureContexts(
  record: RunRecord,
  projectRoot: string,
  radius: number | null,
): Promise<FailureContext[]> {
  const sources = new Map<string, Promise<string | undefined>>();
  const read = (file: string): Promise<string | undefined> => {
    let source = sources.get(file);
    if (!source) {
      source = readProjectFile(projectRoot, file);
      sources.set(file, source);
    }
    return source;
  };

  const parsedSpecs = new Map<string, ParsedSpec | undefined>();
  const parsedOf = async (spec: string): Promise<ParsedSpec | undefined> => {
    if (!parsedSpecs.has(spec)) {
      const source = await read(spec);
      parsedSpecs.set(spec, source === undefined ? undefined : parseSpec(source));
    }
    return parsedSpecs.get(spec);
  };

  return Promise.all(
    record.result.failures.map(async (failure, i) => {
      const spec = failure.spec ?? record.spec;
      const where = locateFailure(failure, spec, await parsedOf(spec));
      const source = where && radius !== null ? await read(where.file) : undefined;
      return {
        index: i + 1,
        spec,
        title: failure.title,
        fullTitle: failure.fullTitle,
        ...errorNameOf(failure.stack),
        error: failure.error,
        ...(where ? { location: formatLocation(where) } : {}),
        ...(failure.diff ? { diff: failure.diff } : {}),
        ...(failure.screenshot ? { screenshot: failure.screenshot } : {}),
        ...(where && source !== undefined && radius !== null
          ? { excerpt: excerptAround(source, where.line, radius) }
          : {}),
        stack: userStack(failure.stack),
        stackHint: extractStackHint(failure.stack),
        ...(failure.page ? { page: failure.page } : {}),
      };
    }),
  );
}

interface Where {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

export function formatLocation(where: Where): string {
  return [where.file, where.line, where.column].filter((part) => part).join(":");
}

/**
 * Where a failure happened. A stack frame in project code is exact (Cypress
 * maps it to the original source). Without one, the test's own it() line is
 * the next best place, so every failure still gets a location.
 */
export function locateFailure(
  failure: FailureDetail,
  spec: string,
  parsed: ParsedSpec | undefined,
): Where | undefined {
  const fromStack = findFailureLocation(failure.stack, spec);
  if (fromStack) {
    return fromStack;
  }

  // Hook failures are titled `"before each" hook for "<test title>"`.
  const hookTarget = /hook for "(.+)"$/.exec(failure.title)?.[1];
  const declared = parsed?.tests.find(
    (test) =>
      test.fullTitle === failure.fullTitle ||
      test.name === failure.title ||
      (hookTarget !== undefined && test.name === hookTarget),
  );
  return declared ? { file: spec, line: declared.line } : undefined;
}

/** `AssertionError` from `AssertionError: expected ...` on the stack's first line. */
function errorNameOf(stack: string): { errorName?: string } {
  const name = /^([A-Z][A-Za-z]*Error)\b/.exec(stack.trimStart())?.[1];
  return name ? { errorName: name } : {};
}

/** The stack without Cypress runner frames, which never help fix a test. */
function userStack(stack: string): string {
  const kept = stack
    .split("\n")
    .filter((line) => !/__cypress|cypress_runner|node_modules/.test(line))
    .join("\n")
    .trim();
  return kept.length > MAX_STACK_CHARS ? `${kept.slice(0, MAX_STACK_CHARS)}...` : kept;
}

/** The most useful stack line: the first that points to user code. */
function extractStackHint(stack: string): string {
  const lines = stack.split("\n").map((l) => l.trim());
  const userLine = lines.find(
    (l) =>
      l.includes(".cy.ts") ||
      l.includes(".cy.js") ||
      l.includes("cypress/e2e") ||
      l.includes("cypress/support"),
  );
  if (userLine) return userLine;
  return lines.find((l) => l.startsWith("at ")) ?? lines[0] ?? "";
}

/** A file inside the project, or undefined when it is outside or unreadable. */
async function readProjectFile(
  projectRoot: string,
  file: string,
): Promise<string | undefined> {
  const absolute = resolveInsideRoot(projectRoot, file);
  if (!absolute) {
    return undefined;
  }
  try {
    return await fs.readFile(absolute, "utf-8");
  } catch {
    return undefined;
  }
}
