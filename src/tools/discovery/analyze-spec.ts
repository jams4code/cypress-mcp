// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { DescribeBlock, SpecAnalysis } from "../../types/results.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_analyze_spec",
    "Deep analysis of a single spec file. Extracts describe/it blocks with line numbers, cy.visit URLs, cy.intercept routes, fixtures used, and custom commands called.",
    {
      spec: z.string().describe("Path to the spec file to analyze"),
    },
    async ({ spec }) => {
      const config = await ctx.configLoader.load();
      const absolute = path.isAbsolute(spec)
        ? spec
        : path.join(config.projectRoot, spec);

      try {
        const content = await fs.readFile(absolute, "utf-8");
        const analysis = analyzeSpec(spec, content);

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(analysis, null, 2) },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Could not read spec file: ${spec}`,
                suggestion: "Check the file path. Use cypress_list_specs to see available specs.",
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function analyzeSpec(file: string, content: string): SpecAnalysis {
  const lines = content.split("\n");

  return {
    file,
    structure: { describes: extractDescribeBlocks(lines) },
    visits: extractPatterns(content, /cy\.visit\s*\(\s*['"`](.+?)['"`]/g),
    intercepts: extractInterceptPatterns(content),
    fixtures: extractPatterns(content, /cy\.fixture\s*\(\s*['"`](.+?)['"`]/g),
    customCommands: extractCustomCommands(content),
  };
}

function extractDescribeBlocks(lines: string[]): DescribeBlock[] {
  const blocks: DescribeBlock[] = [];
  const describeRegex = /describe\s*\(\s*['"`](.+?)['"`]/;
  const itRegex = /it(?:\.only|\.skip)?\s*\(\s*['"`](.+?)['"`]/;
  const hookRegex = /\b(before|beforeEach|after|afterEach)\s*\(/;

  let currentDescribe: DescribeBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const descMatch = describeRegex.exec(line);
    const itMatch = itRegex.exec(line);
    const hookMatch = hookRegex.exec(line);

    if (descMatch?.[1]) {
      currentDescribe = {
        name: descMatch[1],
        tests: [],
        hooks: [],
        nested: [],
      };
      blocks.push(currentDescribe);
    } else if (itMatch?.[1] && currentDescribe) {
      (currentDescribe.tests as { name: string; line: number }[]).push({
        name: itMatch[1],
        line: i + 1,
      });
    } else if (itMatch?.[1] && !currentDescribe) {
      if (blocks.length === 0) {
        currentDescribe = { name: "(root)", tests: [], hooks: [], nested: [] };
        blocks.push(currentDescribe);
      }
      (blocks[0]!.tests as { name: string; line: number }[]).push({
        name: itMatch[1],
        line: i + 1,
      });
    } else if (hookMatch?.[1] && currentDescribe) {
      if (!(currentDescribe.hooks as string[]).includes(hookMatch[1])) {
        (currentDescribe.hooks as string[]).push(hookMatch[1]);
      }
    }
  }

  return blocks;
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
    "get", "find", "contains", "click", "type", "visit", "intercept",
    "request", "wait", "fixture", "wrap", "should", "then", "and",
    "its", "invoke", "within", "as", "trigger", "select", "check",
    "uncheck", "clear", "submit", "focus", "blur", "scrollTo",
    "scrollIntoView", "dblclick", "rightclick", "hover", "reload",
    "go", "back", "forward", "viewport", "window", "document",
    "title", "url", "hash", "location", "readFile", "writeFile",
    "task", "log", "pause", "debug", "screenshot", "clock",
    "tick", "stub", "spy", "mount", "on", "once", "off",
    "getCookie", "getCookies", "setCookie", "clearCookie", "clearCookies",
    "getAllLocalStorage", "clearAllLocalStorage",
    "getAllSessionStorage", "clearAllSessionStorage",
    "session", "origin",
  ]);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !builtins.has(match[1])) {
      results.push(`cy.${match[1]}`);
    }
  }

  return [...new Set(results)];
}
