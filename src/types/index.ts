export type {
  CypressMcpConfig,
  RawServerConfig,
} from "./config.js";
export {
  DEFAULT_CONFIG,
  CYPRESS_CONFIG_FILES,
  SERVER_CONFIG_FILE,
} from "./config.js";

export type {
  MochaJsonReport,
  MochaStats,
  MochaTest,
  MochaError,
  CypressRunArgs,
} from "./cypress.js";

export type {
  CypressRunResult,
  RunStats,
  TestState,
  TestResult,
  TestError,
  FailureDetail,
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

export interface ToolContext {
  readonly config: CypressMcpConfig;
  readonly processManager: ProcessManager;
  readonly outputParser: OutputParser;
  readonly configLoader: ConfigLoader;
  readonly specFinder: SpecFinder;
  readonly screenshotResolver: ScreenshotResolver;
  readonly stateStore: StateStore;
  readonly logger: Logger;
}
