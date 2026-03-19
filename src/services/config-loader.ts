import fs from "node:fs/promises";
import path from "node:path";
import type { CypressMcpConfig, RawServerConfig } from "../types/config.js";
import {
  CYPRESS_CONFIG_FILES,
  DEFAULT_CONFIG,
  SERVER_CONFIG_FILE,
} from "../types/config.js";
import { ConfigNotFoundError } from "../utils/errors.js";
import { normalizePath } from "../utils/paths.js";
import type { Logger } from "../utils/logger.js";

export class ConfigLoader {
  private cached: CypressMcpConfig | null = null;

  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<CypressMcpConfig> {
    if (this.cached) return this.cached;

    const configFile = await this.findCypressConfig();
    if (!configFile) {
      throw new ConfigNotFoundError(this.projectRoot);
    }

    const serverConfig = await this.loadServerConfig();

    this.cached = {
      projectRoot: normalizePath(this.projectRoot),
      cypressConfigFile: configFile,
      defaultBrowser: serverConfig?.defaultBrowser ?? DEFAULT_CONFIG.defaultBrowser,
      defaultTimeout: serverConfig?.defaultTimeout ?? DEFAULT_CONFIG.defaultTimeout,
      screenshotsDir: serverConfig?.screenshotsDir ?? DEFAULT_CONFIG.screenshotsDir,
      downloadsDir: serverConfig?.downloadsDir ?? DEFAULT_CONFIG.downloadsDir,
      specPattern: DEFAULT_CONFIG.specPattern,
      authCommand: serverConfig?.authCommand,
      authTokenPath: serverConfig?.authTokenPath,
    };

    this.logger.info("Config loaded", {
      configFile,
      projectRoot: this.projectRoot,
    });

    return this.cached;
  }

  private async findCypressConfig(): Promise<string | null> {
    for (const file of CYPRESS_CONFIG_FILES) {
      const fullPath = path.join(this.projectRoot, file);
      try {
        await fs.access(fullPath);
        return file;
      } catch {
        // File doesn't exist, try next
      }
    }
    return null;
  }

  private async loadServerConfig(): Promise<RawServerConfig | null> {
    const configPath = path.join(this.projectRoot, SERVER_CONFIG_FILE);
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        this.logger.info("Server config loaded", { path: configPath });
        return parsed as RawServerConfig;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Invalidate cached config (useful after config changes) */
  invalidate(): void {
    this.cached = null;
  }
}
