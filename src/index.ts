// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ConfigLoader } from "./services/config-loader.js";
import { ProcessManager } from "./services/process-manager.js";
import { OutputParser } from "./services/output-parser.js";
import { SpecFinder } from "./services/spec-finder.js";
import { ScreenshotResolver } from "./services/screenshot-resolver.js";
import { StateStore } from "./services/state-store.js";
import { createLogger } from "./utils/logger.js";
import type { ToolContext } from "./types/index.js";

export async function main(argv: string[]): Promise<void> {
  const cwd = parseCwd(argv);
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const logger = createLogger(verbose);

  logger.info("Starting cypress-mcp server", { cwd, verbose });

  const configLoader = new ConfigLoader(cwd, logger);

  // Load config eagerly to fail fast on misconfiguration
  let config;
  try {
    config = await configLoader.load();
  } catch (err) {
    // Config not found is OK - tools will report it when called
    logger.warn("Could not load config at startup, tools will retry on demand", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Create a minimal config for service initialization
    config = {
      projectRoot: cwd,
      cypressConfigFile: "",
      defaultBrowser: "electron",
      defaultTimeout: 300_000,
      screenshotsDir: "cypress/screenshots",
      downloadsDir: "cypress/downloads",
      specPattern: "cypress/e2e/**/*.cy.{ts,js,tsx,jsx}",
    };
  }

  const ctx: ToolContext = {
    config,
    processManager: new ProcessManager(config.projectRoot, logger),
    outputParser: new OutputParser(logger),
    configLoader,
    specFinder: new SpecFinder(config.projectRoot, logger),
    screenshotResolver: new ScreenshotResolver(
      config.projectRoot,
      config.screenshotsDir,
      logger,
    ),
    stateStore: new StateStore(),
    logger,
  };

  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Server connected, waiting for requests");

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info("Shutting down");
    ctx.processManager.abort();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseCwd(argv: string[]): string {
  const cwdIndex = argv.indexOf("--cwd");
  const cwdValue = cwdIndex !== -1 ? argv[cwdIndex + 1] : undefined;
  return cwdValue ?? process.cwd();
}

// Auto-start when run directly
main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
