import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_validate_config",
    "Validate the Cypress project configuration. Checks for config file, support file, spec files, and dependencies.",
    {},
    async () => {
      const issues: string[] = [];
      const warnings: string[] = [];
      const info: string[] = [];

      try {
        const config = await ctx.configLoader.load();
        info.push(`Config file: ${config.cypressConfigFile}`);
        info.push(`Project root: ${config.projectRoot}`);

        // Check for specs
        const specs = await ctx.specFinder.findSpecs();
        if (specs.length === 0) {
          issues.push("No spec files found matching the default pattern.");
        } else {
          info.push(`Spec files found: ${specs.length}`);
        }

        // Check support file
        const supportFiles = [
          "cypress/support/e2e.ts",
          "cypress/support/e2e.js",
        ];
        let supportFound = false;
        for (const sf of supportFiles) {
          try {
            await fs.access(path.join(config.projectRoot, sf));
            info.push(`Support file: ${sf}`);
            supportFound = true;
            break;
          } catch {
            // Try next
          }
        }
        if (!supportFound) {
          warnings.push("No support file found (cypress/support/e2e.ts or .js).");
        }

        // Check for Cypress in node_modules
        const cypressDir = path.join(
          config.projectRoot,
          "node_modules",
          "cypress",
        );
        try {
          await fs.access(cypressDir);
          const pkgRaw = await fs.readFile(
            path.join(cypressDir, "package.json"),
            "utf-8",
          );
          const pkg: { version?: string } = JSON.parse(pkgRaw);
          info.push(`Cypress version: ${pkg.version ?? "unknown"}`);
        } catch {
          issues.push(
            "Cypress not found in node_modules. Run 'npm install cypress'.",
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  valid: issues.length === 0,
                  issues,
                  warnings,
                  info,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                valid: false,
                issues: [message],
                warnings: [],
                info: [],
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
