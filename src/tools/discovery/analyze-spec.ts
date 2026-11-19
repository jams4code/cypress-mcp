// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import type { DescribeBlock, SpecAnalysis } from "../../types/results.js";
import { parseSpec, type ParsedSuite } from "../../services/spec-parser.js";
import { finish } from "../../format/compact.js";
import { READ_ONLY, envelopeSchema, errorResult, textResult } from "../result.js";

const TOOL = "cypress_analyze_spec";

const analysisDataSchema = z.object({
  file: z.string(),
  structure: z.object({
    describes: z
      .array(z.looseObject({ name: z.string() }))
      .describe("Suites with tests (name, line, mode), hooks and nested suites"),
  }),
  visits: z.array(z.string()),
  intercepts: z.array(z.string()),
  fixtures: z.array(z.string()),
  customCommands: z.array(z.string()),
});

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Analyze a Cypress spec",
      description:
        "Outline of one spec file, read statically: describe/it blocks with line numbers and hooks, cy.visit URLs, cy.intercept routes, fixtures and custom commands.",
      inputSchema: z.object({
        spec: z.string().describe("Path to the spec file to analyze"),
      }),
      outputSchema: envelopeSchema(analysisDataSchema),
      annotations: READ_ONLY,
    },
    async ({ spec }) => {
      try {
        const resolvedSpec = await ctx.specFinder.resolveSpec(spec);
        const content = await fs.readFile(
          path.join(ctx.projectRoot, resolvedSpec),
          "utf-8",
        );
        const analysis = analyzeSpec(resolvedSpec, content);
        const testCount = countTests(analysis.structure.describes);
        const summary = `${resolvedSpec}: ${testCount} test(s)`;

        return textResult(finish([summary, ...outline(analysis)], []), {
          ok: true,
          tool: TOOL,
          summary,
          data: analysis,
          nextActions: [],
        });
      } catch (err) {
        return errorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

function countTests(blocks: readonly DescribeBlock[]): number {
  return blocks.reduce(
    (sum, block) => sum + block.tests.length + countTests(block.nested),
    0,
  );
}

/** Indented describe/it tree with line numbers, then the lists. */
function outline(analysis: SpecAnalysis): string[] {
  const lines: string[] = [];
  const walk = (block: DescribeBlock, depth: number): void => {
    const pad = "  ".repeat(depth);
    const mode = block.mode ? `.${block.mode}` : "";
    const hooks = block.hooks.length > 0 ? ` hooks: ${block.hooks.join(", ")}` : "";
    lines.push(
      `${pad}${block.line ? `${block.line}: ` : ""}describe${mode} ${JSON.stringify(block.name)}${hooks}`,
    );
    for (const test of block.tests) {
      lines.push(
        `${pad}  ${test.line}: it${test.mode ? `.${test.mode}` : ""} ${JSON.stringify(test.name)}`,
      );
    }
    for (const nested of block.nested) walk(nested, depth + 1);
  };
  for (const block of analysis.structure.describes) walk(block, 0);

  const list = (label: string, values: readonly string[]): void => {
    if (values.length > 0) lines.push(`${label}: ${values.join(", ")}`);
  };
  list("visits", analysis.visits);
  list("intercepts", analysis.intercepts);
  list("fixtures", analysis.fixtures);
  list("custom commands", analysis.customCommands);
  return lines;
}

function analyzeSpec(file: string, content: string): SpecAnalysis {
  return {
    file,
    structure: { describes: toDescribeBlocks(parseSpec(content).root) },
    visits: extractPatterns(content, /cy\.visit\s*\(\s*['"`](.+?)['"`]/g),
    intercepts: extractInterceptPatterns(content),
    fixtures: extractPatterns(content, /cy\.fixture\s*\(\s*['"`](.+?)['"`]/g),
    customCommands: extractCustomCommands(content),
  };
}

/** Top-level suites, preceded by a "(root)" block for tests and hooks outside any describe. */
function toDescribeBlocks(root: ParsedSuite): DescribeBlock[] {
  const blocks = root.suites.map(toDescribeBlock);
  if (root.tests.length > 0 || root.hooks.length > 0) {
    blocks.unshift({ ...toDescribeBlock(root), name: "(root)", nested: [] });
  }
  return blocks;
}

function toDescribeBlock(suite: ParsedSuite): DescribeBlock {
  return {
    name: suite.name,
    ...(suite.line > 0 ? { line: suite.line } : {}),
    ...(suite.mode ? { mode: suite.mode } : {}),
    tests: suite.tests.map((test) => ({
      name: test.name,
      line: test.line,
      ...(test.mode ? { mode: test.mode } : {}),
    })),
    hooks: [...suite.hooks],
    nested: suite.suites.map(toDescribeBlock),
  };
}

function extractPatterns(content: string, regex: RegExp): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      results.push(match[1]);
    }
  }
  return [...new Set(results)];
}

function extractInterceptPatterns(content: string): string[] {
  const results: string[] = [];
  const regex =
    /cy\.intercept\s*\(\s*['"`]?(GET|POST|PUT|DELETE|PATCH)['"`]?\s*,\s*['"`](.+?)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && match[2]) {
      results.push(`${match[1]} ${match[2]}`);
    }
  }
  return [...new Set(results)];
}

function extractCustomCommands(content: string): string[] {
  const results: string[] = [];
  const regex = /cy\.(\w+)\s*\(/g;

  // Standard Cypress commands to exclude
  const builtins = new Set([
    "get",
    "find",
    "contains",
    "click",
    "type",
    "visit",
    "intercept",
    "request",
    "wait",
    "fixture",
    "wrap",
    "should",
    "then",
    "and",
    "its",
    "invoke",
    "within",
    "as",
    "trigger",
    "select",
    "check",
    "uncheck",
    "clear",
    "submit",
    "focus",
    "blur",
    "scrollTo",
    "scrollIntoView",
    "dblclick",
    "rightclick",
    "hover",
    "reload",
    "go",
    "back",
    "forward",
    "viewport",
    "window",
    "document",
    "title",
    "url",
    "hash",
    "location",
    "readFile",
    "writeFile",
    "task",
    "log",
    "pause",
    "debug",
    "screenshot",
    "clock",
    "tick",
    "stub",
    "spy",
    "mount",
    "on",
    "once",
    "off",
    "getCookie",
    "getCookies",
    "setCookie",
    "clearCookie",
    "clearCookies",
    "getAllLocalStorage",
    "clearAllLocalStorage",
    "getAllSessionStorage",
    "clearAllSessionStorage",
    "session",
    "origin",
  ]);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !builtins.has(match[1])) {
      results.push(`cy.${match[1]}`);
    }
  }

  return [...new Set(results)];
}
