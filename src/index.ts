// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ConfigLoader } from "./services/config-loader.js";
import { ProcessManager } from "./services/process-manager.js";
import { OutputParser } from "./services/output-parser.js";
import { SpecFinder } from "./services/spec-finder.js";
import { ScreenshotResolver } from "./services/screenshot-resolver.js";
import { StateStore } from "./services/state-store.js";
import { DEFAULT_CONFIG } from "./types/config.js";
import { createLogger } from "./utils/logger.js";
import type { ToolContext } from "./types/index.js";

export async function main(argv: string[]): Promise<void> {
  const cwd = parseCwd(argv);
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const logger = createLogger(verbose);

  logger.info("Starting cypress-mcp server", { cwd, verbose });

  const configLoader = new ConfigLoader(cwd, logger);

  // Load eagerly so misconfiguration shows up in the logs right away.
  // A missing config is not fatal: tools load it again on every call.
  try {
    await configLoader.load();
  } catch (err) {
    logger.warn("Could not load config at startup, tools will retry on demand", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const ctx: ToolContext = {
    processManager: new ProcessManager(cwd, logger),
    outputParser: new OutputParser(logger),
    configLoader,
    specFinder: new SpecFinder(cwd, logger),
    screenshotResolver: new ScreenshotResolver(
      cwd,
      async () => {
        try {
          return (await configLoader.load()).screenshotsDir;
        } catch {
          return DEFAULT_CONFIG.screenshotsDir;
        }
      },
      logger,
    ),
    stateStore: new StateStore(),
    logger,
  };

  const server = createServer(ctx);
  const transport = new StdioServerTransport();

  // The client closing stdin is the normal way an MCP session ends. Kill any
  // running Cypress so it cannot outlive the session, then let Node exit on
  // its own once pending responses are flushed.
  const onDisconnect = (): void => {
    logger.info("Client disconnected");
    void ctx.processManager.abort();
  };
  transport.onclose = onDisconnect;
  process.stdin.on("end", onDisconnect);

  const onSignal = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    await ctx.processManager.abort();
    process.exit(0);
  };
  process.on("SIGINT", () => void onSignal("SIGINT"));
  process.on("SIGTERM", () => void onSignal("SIGTERM"));

  await server.connect(transport);
  logger.info("Server connected, waiting for requests");
}

function parseCwd(argv: string[]): string {
  const cwdIndex = argv.indexOf("--cwd");
  const cwdValue = cwdIndex !== -1 ? argv[cwdIndex + 1] : undefined;
  return path.resolve(cwdValue ?? process.cwd());
}

// Auto-start when run directly
main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
