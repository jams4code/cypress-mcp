// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { classifyConfigRuntimeCheck } from "../../utils/cypress-diagnostics.js";
import { normalizePath } from "../../utils/paths.js";

const SUPPORT_FILES = [
  "cypress/support/e2e.ts",
  "cypress/support/e2e.js",
  "cypress/support/index.ts",
  "cypress/support/index.js",
];

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_doctor",
    "Comprehensive health check of the Cypress project. Validates config file, binary, spec files, support file, and directories. Use this to diagnose setup issues.",
    {},
    async () => {
      const checks: { check: string; status: "ok" | "warn" | "fail"; detail: string }[] =
        [];

      // 1. Config file
      try {
        const config = await ctx.configLoader.load();
        checks.push({
          check: "Config file",
          status: "ok",
          detail: config.cypressConfigFile,
        });

        // 2. Spec files
        const specs = await ctx.specFinder.findSpecs(config.specPattern);
        checks.push({
          check: "Spec files",
          status: specs.length > 0 ? "ok" : "warn",
          detail:
            specs.length > 0
              ? `${specs.length} spec files found`
              : `No spec files found matching ${config.specPattern.join(", ")}`,
        });

        // 3. Support file
        const configuredSupportFiles =
          typeof config.supportFile === "string"
            ? [config.supportFile]
            : config.supportFile === false
              ? []
              : SUPPORT_FILES;

        let supportFound = config.supportFile === false;
        if (config.supportFile === false) {
          checks.push({
            check: "Support file",
            status: "ok",
            detail: "Disabled by Cypress config",
          });
        }

        for (const sf of configuredSupportFiles) {
          try {
            await fs.access(path.join(config.projectRoot, sf));
            checks.push({ check: "Support file", status: "ok", detail: sf });
            supportFound = true;
            break;
          } catch {
            /* try next */
          }
        }
        if (!supportFound) {
          checks.push({
            check: "Support file",
            status: "warn",
            detail: `Not found (${configuredSupportFiles.join(", ")})`,
          });
        }

        // 4. Cypress binary
        let resolvedBinary: string | null = null;
        try {
          const binary = await ctx.processManager.resolveBinary();
          resolvedBinary = binary;
          checks.push({
            check: "Cypress binary",
            status: "ok",
            detail: normalizePath(path.relative(config.projectRoot, binary)),
          });
        } catch {
          checks.push({
            check: "Cypress binary",
            status: "fail",
            detail: "Not found. Run: npm install --save-dev cypress",
          });
        }

        // 5. Config runtime validation
        if (resolvedBinary) {
          try {
            const validation = await ctx.processManager.run({
              spec: "__cypress_mcp_config_check__.cy.ts",
              browser: config.defaultBrowser,
              timeout: Math.min(config.defaultTimeout, 30_000),
              configFile: config.cypressConfigFile,
            });
            const runtimeCheck = classifyConfigRuntimeCheck(
              validation.exitCode,
              validation.stdout,
              validation.stderr,
            );
            checks.push({
              check: "Config runtime",
              status: runtimeCheck.status,
              detail: runtimeCheck.detail,
            });
          } catch (err) {
            checks.push({
              check: "Config runtime",
              status: "warn",
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          checks.push({
            check: "Config runtime",
            status: "warn",
            detail: "Skipped because the Cypress binary was not found.",
          });
        }

        // 6. Title filter support
        checks.push({
          check: "Test title filter",
          status: config.titleFilterSupport ? "ok" : "warn",
          detail: config.titleFilterSupport
            ? "Configured for cypress_run_test"
            : "Not configured. Use cypress_run_spec or add @cypress/grep.",
        });

        // 7. Cypress Cloud (optional)
        checks.push(
          cloudCheck(config.projectId, Boolean(process.env["CYPRESS_RECORD_KEY"])),
        );

        // 8. Screenshots dir
        const ssDir = path.join(config.projectRoot, config.screenshotsDir);
        try {
          await fs.access(ssDir);
          checks.push({
            check: "Screenshots dir",
            status: "ok",
            detail: normalizePath(config.screenshotsDir),
          });
        } catch {
          checks.push({
            check: "Screenshots dir",
            status: "warn",
            detail: `${config.screenshotsDir} (will be created on first run)`,
          });
        }

        // 9. Downloads dir
        const dlDir = path.join(config.projectRoot, config.downloadsDir);
        try {
          await fs.access(dlDir);
          checks.push({
            check: "Downloads dir",
            status: "ok",
            detail: normalizePath(config.downloadsDir),
          });
        } catch {
          checks.push({
            check: "Downloads dir",
            status: "warn",
            detail: `${config.downloadsDir} (will be created on first run)`,
          });
        }
      } catch (err) {
        checks.push({
          check: "Config file",
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      const failed = checks.filter((c) => c.status === "fail").length;
      const warned = checks.filter((c) => c.status === "warn").length;
      const healthy = failed === 0;

      const summary = healthy
        ? warned > 0
          ? `Project looks good with ${warned} warning(s)`
          : "Project is healthy and ready to run tests"
        : `${failed} issue(s) need attention`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: healthy,
                tool: "cypress_doctor",
                summary,
                data: { checks },
                nextActions: healthy
                  ? ["cypress_discover", "cypress_run_spec"]
                  : ["Fix the issues above, then run cypress_doctor again"],
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

/** Cloud is optional, so a project without it is healthy. Exported for tests. */
export function cloudCheck(
  projectId: string | undefined,
  hasRecordKey: boolean,
): { check: string; status: "ok" | "warn"; detail: string } {
  const check = "Cypress Cloud";
  if (projectId && hasRecordKey) {
    return { check, status: "ok", detail: `Ready to record (projectId ${projectId})` };
  }
  if (projectId) {
    return {
      check,
      status: "warn",
      detail: `projectId ${projectId} found, but CYPRESS_RECORD_KEY is not set in the server environment, so record: true will fail`,
    };
  }
  if (hasRecordKey) {
    return {
      check,
      status: "warn",
      detail:
        "CYPRESS_RECORD_KEY is set but no projectId was found in the Cypress config",
    };
  }
  return {
    check,
    status: "ok",
    detail: "Not configured (optional, only needed to record runs)",
  };
}
