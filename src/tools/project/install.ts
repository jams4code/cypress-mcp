import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { CypressMcpError } from "../../utils/errors.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_install",
    "Run Cypress installation and verification. Ensures Cypress binary is downloaded and ready.",
    {},
    async () => {
      try {
        // First try verify
        const verifyResult = await ctx.processManager.verify();

        if (verifyResult.exitCode === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  installed: true,
                  verified: true,
                  output: verifyResult.stdout.trim(),
                }),
              },
            ],
          };
        }

        // If verify fails, try install
        ctx.logger.info("Cypress verify failed, attempting install");
        const installResult = await ctx.processManager.install();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                installed: installResult.exitCode === 0,
                verified: false,
                output: installResult.stdout.trim(),
                error:
                  installResult.exitCode !== 0
                    ? installResult.stderr.trim()
                    : undefined,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof CypressMcpError) {
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(err.toJSON()) },
            ],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
