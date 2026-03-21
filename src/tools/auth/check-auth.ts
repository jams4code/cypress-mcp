import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { z } from "zod";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_check_auth",
    "Check if authentication tokens exist and are valid. Reads the token file and reports status and expiry.",
    {
      tokenPath: z
        .string()
        .optional()
        .describe("Path to token file (overrides config)"),
    },
    async ({ tokenPath }) => {
      const config = await ctx.configLoader.load();
      const resolvedPath = tokenPath ?? config.authTokenPath;

      if (!resolvedPath) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                authenticated: false,
                message:
                  "No token path configured. Set authTokenPath in cypress-mcp.config.json.",
              }),
            },
          ],
        };
      }

      const fullPath = path.isAbsolute(resolvedPath)
        ? resolvedPath
        : path.join(config.projectRoot, resolvedPath);

      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const tokens: unknown = JSON.parse(raw);

        if (typeof tokens !== "object" || tokens === null) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  authenticated: false,
                  message: "Token file exists but has invalid format.",
                }),
              },
            ],
          };
        }

        const tokenObj = tokens as Record<string, unknown>;

        // Check for common expiry fields
        const expiresAt =
          tokenObj["expiresAt"] ??
          tokenObj["expires_at"] ??
          tokenObj["exp"] ??
          tokenObj["expiresOn"];

        let expired = false;
        let expiryInfo: string | undefined;

        if (typeof expiresAt === "number") {
          const expiryDate = new Date(
            expiresAt > 1e12 ? expiresAt : expiresAt * 1000,
          );
          expired = expiryDate.getTime() < Date.now();
          expiryInfo = expiryDate.toISOString();
        } else if (typeof expiresAt === "string") {
          const expiryDate = new Date(expiresAt);
          expired = expiryDate.getTime() < Date.now();
          expiryInfo = expiresAt;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                authenticated: !expired,
                expired,
                expiresAt: expiryInfo ?? "unknown",
                tokenPath: fullPath,
              }),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                authenticated: false,
                message: `Token file not found at ${fullPath}`,
              }),
            },
          ],
        };
      }
    },
  );
}
