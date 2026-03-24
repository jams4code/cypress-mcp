// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_failure_context",
    "Get a compact debugging bundle for the most recent failure. Returns the failing test, error, stack hint, screenshot paths, relevant spec excerpt, and recommended next actions. This is the key tool for the fix-and-rerun loop.",
    {},
    async () => {
      const lastRun = ctx.stateStore.getLastRun();

      if (!lastRun) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                tool: "cypress_get_failure_context",
                summary: "No test run recorded. Run a spec first.",
                data: null,
                nextActions: ["cypress_run_spec", "cypress_discover"],
              }),
            },
          ],
        };
      }

      if (lastRun.result.failures.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                tool: "cypress_get_failure_context",
                summary: "Last run had no failures.",
                data: { runId: lastRun.runId, spec: lastRun.spec },
                nextActions: ["cypress_discover"],
              }),
            },
          ],
        };
      }

      // Build context for each failure
      const config = await ctx.configLoader.load();
      const failures = await Promise.all(
        lastRun.result.failures.map(async (f) => {
          const specExcerpt = await getSpecExcerpt(
            config.projectRoot,
            lastRun.spec,
            f.error,
          );

          return {
            testTitle: f.title,
            fullTitle: f.fullTitle,
            error: f.error,
            stackHint: extractStackHint(f.stack),
            diff: f.diff,
            screenshot: f.screenshot,
            specExcerpt,
          };
        }),
      );

      const screenshots = await ctx.screenshotResolver.find(lastRun.spec);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                tool: "cypress_get_failure_context",
                summary: `${failures.length} failure(s) in ${lastRun.spec}`,
                data: {
                  runId: lastRun.runId,
                  spec: lastRun.spec,
                  failures,
                  screenshots,
                  stderrTail: lastRun.stderrTail || undefined,
                },
                nextActions: [
                  "Fix the failing test(s) based on the error and spec excerpt",
                  "cypress_rerun_last",
                  "cypress_get_screenshot",
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

/** Extract the most useful line from a stack trace */
function extractStackHint(stack: string): string {
  const lines = stack.split("\n").map((l) => l.trim());

  // Find the first line that points to user code (not cypress internals)
  const userLine = lines.find(
    (l) =>
      l.includes(".cy.ts") ||
      l.includes(".cy.js") ||
      l.includes("cypress/e2e") ||
      l.includes("cypress/support"),
  );

  if (userLine) return userLine;

  // Fallback: first non-empty line after the error message
  return lines.find((l) => l.startsWith("at ")) ?? lines[0] ?? "";
}

/** Read the spec file and extract lines around the likely failure point */
async function getSpecExcerpt(
  projectRoot: string,
  spec: string,
  errorMessage: string,
): Promise<string | undefined> {
  const absolute = path.isAbsolute(spec)
    ? spec
    : path.join(projectRoot, spec);

  try {
    const content = await fs.readFile(absolute, "utf-8");
    const lines = content.split("\n");

    // Try to find the line containing the failing assertion or command
    const keywords = extractKeywords(errorMessage);
    let bestLine = -1;

    for (const keyword of keywords) {
      const idx = lines.findIndex((l) =>
        l.toLowerCase().includes(keyword.toLowerCase()),
      );
      if (idx !== -1) {
        bestLine = idx;
        break;
      }
    }

    if (bestLine === -1) return undefined;

    // Return ~10 lines of context around the failure
    const start = Math.max(0, bestLine - 5);
    const end = Math.min(lines.length, bestLine + 5);

    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === bestLine + 1 ? " >>>" : "    ";
        return `${marker} ${lineNum}: ${l}`;
      })
      .join("\n");
  } catch {
    return undefined;
  }
}

/** Extract searchable keywords from an error message */
function extractKeywords(errorMessage: string): string[] {
  const keywords: string[] = [];

  // Extract selector from cy.get('...') references
  const selectorMatch = errorMessage.match(/['"`]([^'"`]+)['"`]/);
  if (selectorMatch?.[1]) keywords.push(selectorMatch[1]);

  // Extract method name
  const methodMatch = errorMessage.match(/cy\.(\w+)\(\)/);
  if (methodMatch?.[1]) keywords.push(methodMatch[1]);

  // Extract expected content
  const contentMatch = errorMessage.match(/content:\s*['"`]([^'"`]+)['"`]/);
  if (contentMatch?.[1]) keywords.push(contentMatch[1]);

  return keywords;
}
