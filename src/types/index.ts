// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
export type { CypressMcpConfig, RawServerConfig } from "./config.js";
export { DEFAULT_CONFIG, CYPRESS_CONFIG_FILES, SERVER_CONFIG_FILE } from "./config.js";

export type {
  MochaJsonReport,
  MochaStats,
  MochaTest,
  MochaError,
  CypressRunArgs,
  CloudRecordArgs,
} from "./cypress.js";

export type {
  CypressRunResult,
  CloudRunInfo,
  RunStats,
  TestState,
  TestResult,
  TestError,
  FailureDetail,
  PageContext,
  ConsoleEntry,
  FailedRequest,
  CommandEntry,
  DiscoveryResult,
  SpecSummary,
  SpecAnalysis,
  DescribeBlock,
} from "./results.js";

// Service context passed to all tool handlers
import type { ProcessManager } from "../services/process-manager.js";
import type { OutputParser } from "../services/output-parser.js";
import type { ConfigLoader } from "../services/config-loader.js";
import type { SpecFinder } from "../services/spec-finder.js";
import type { ScreenshotResolver } from "../services/screenshot-resolver.js";
import type { StateStore } from "../services/state-store.js";
import type { Logger } from "../utils/logger.js";
import type { ProjectRegistry } from "../services/projects.js";

export interface ToolContext {
  /** Absolute root of this Cypress project: --cwd, or a project folder under it */
  readonly projectRoot: string;
  /** Absolute --cwd root, which paths shown to the agent are relative to */
  readonly serverRoot: string;
  /** Every project under the server root (monorepos) */
  readonly projects: ProjectRegistry;
  /**
   * Set when Cypress could not load this project's config through the
   * wrapper: later runs skip it. Holds the reason.
   */
  wrapperDisabled?: string;
  readonly processManager: ProcessManager;
  readonly outputParser: OutputParser;
  readonly configLoader: ConfigLoader;
  readonly specFinder: SpecFinder;
  readonly screenshotResolver: ScreenshotResolver;
  readonly stateStore: StateStore;
  readonly logger: Logger;
}
