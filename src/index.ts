// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer, SERVER_VERSION } from "./server.js";
import { createToolContext } from "./context.js";
import { CAPABILITIES, parseCaps } from "./caps.js";
import { CLI_USAGE, runCli } from "./cli.js";
import { createLogger } from "./utils/logger.js";
import { resolveProjectRoot } from "./utils/paths.js";
import { abortAllRuns } from "./services/process-manager.js";

export async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  if (command === "run") {
    process.exitCode = await runCli(argv.slice(1));
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(`${CLI_USAGE}\n`);
    return;
  }
  if (command === "--version" || command === "-V") {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  await startServer(argv);
}

async function startServer(argv: string[]): Promise<void> {
  const cwd = resolveProjectRoot(argv, process.env, process.cwd());
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const logger = createLogger(verbose);
  const { caps, unknown } = parseCaps(argv, process.env);

  logger.info("Starting cypress-mcp server", {
    cwd,
    caps: [...caps],
    version: SERVER_VERSION,
  });
  if (unknown.length > 0) {
    logger.warn("Ignoring unknown --caps values", {
      unknown,
      known: [...Object.keys(CAPABILITIES), "all"],
    });
  }

  const ctx = createToolContext(cwd, logger);

  // Load eagerly so misconfiguration shows up in the logs right away.
  // A missing config is not fatal: tools load it again on every call.
  try {
    await ctx.configLoader.load();
  } catch (err) {
    logger.warn("Could not load config at startup, tools will retry on demand", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // serveStdio answers both protocol eras: 2025 clients that open with
  // initialize, and 2026-07-28 clients that send per-request metadata.
  serveStdio(() => createServer(ctx, caps), {
    onerror: (error) => logger.error("Transport error", { error: error.message }),
  });

  // The client closing stdin is the normal way an MCP session ends. Kill any
  // running Cypress so it cannot outlive the session, then let Node exit on
  // its own once pending responses are flushed.
  process.stdin.on("end", () => {
    logger.info("Client disconnected");
    void abortAllRuns();
  });

  const onSignal = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    await abortAllRuns();
    process.exit(0);
  };
  process.on("SIGINT", () => void onSignal("SIGINT"));
  process.on("SIGTERM", () => void onSignal("SIGTERM"));

  logger.info("Server ready on stdio");
}

// Auto-start when run directly
main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
