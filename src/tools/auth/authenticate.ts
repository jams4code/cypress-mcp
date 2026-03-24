// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_authenticate",
    "Run the project's authentication command to acquire or refresh tokens. Requires authCommand in cypress-mcp.config.json.",
    {
      url: z.string().optional().describe("Target URL for authentication"),
    },
    async ({ url }) => {
      const config = await ctx.configLoader.load();

      if (!config.authCommand) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message:
                  "No authCommand configured. Set authCommand in cypress-mcp.config.json.",
                example: { authCommand: "npm run authenticate" },
              }),
            },
          ],
        };
      }

      // Split the configured command into binary + args safely
      const parts = config.authCommand.split(/\s+/);
      const bin = parts[0]!;
      const args = parts.slice(1);
      if (url) {
        args.push("--url", url);
      }

      try {
        const result = await spawnAsync(bin, args, config.projectRoot);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.exitCode === 0,
                command: config.authCommand,
                stdout: result.stdout.trim(),
                stderr: result.stderr.trim() || undefined,
              }),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                command: config.authCommand,
                error: message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function spawnAsync(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode,
      });
    });

    child.on("error", reject);
  });
}
