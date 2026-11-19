// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { ConfigLoader } from "./services/config-loader.js";
import { ProcessManager } from "./services/process-manager.js";
import { OutputParser } from "./services/output-parser.js";
import { SpecFinder } from "./services/spec-finder.js";
import { ScreenshotResolver } from "./services/screenshot-resolver.js";
import { StateStore } from "./services/state-store.js";
import { ProjectRegistry } from "./services/projects.js";
import path from "node:path";
import { DEFAULT_CONFIG } from "./types/config.js";
import type { ToolContext } from "./types/index.js";
import type { Logger } from "./utils/logger.js";

import { REPORTER_PATH } from "./package-paths.js";

export { REPORTER_PATH };

/**
 * Services for the Cypress project at the server root, shared by the MCP
 * server and the CLI. Projects in subfolders (monorepos) get their own
 * context from ctx.projects, sharing the run store with this one.
 */
export function createToolContext(serverRoot: string, logger: Logger): ToolContext {
  const root = path.resolve(serverRoot);
  const stateStore = new StateStore();
  const projects: ProjectRegistry = new ProjectRegistry(root, (projectRoot) =>
    projectContext(projectRoot, root, projects, stateStore, logger),
  );
  return projects.context(root);
}

function projectContext(
  projectRoot: string,
  serverRoot: string,
  projects: ProjectRegistry,
  stateStore: StateStore,
  logger: Logger,
): ToolContext {
  const configLoader = new ConfigLoader(projectRoot, logger);
  return {
    projectRoot,
    serverRoot,
    projects,
    processManager: new ProcessManager(projectRoot, logger, REPORTER_PATH),
    outputParser: new OutputParser(logger),
    configLoader,
    specFinder: new SpecFinder(projectRoot, logger),
    screenshotResolver: new ScreenshotResolver(
      projectRoot,
      async () => {
        try {
          return (await configLoader.load()).screenshotsDir;
        } catch {
          return DEFAULT_CONFIG.screenshotsDir;
        }
      },
      logger,
    ),
    stateStore,
    logger,
  };
}
