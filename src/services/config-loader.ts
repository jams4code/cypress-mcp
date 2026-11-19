// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
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

/** Size and modification time of each file a config was built from. */
type Fingerprint = Map<string, string>;

export class ConfigLoader {
  private cached: { config: CypressMcpConfig; fingerprint: Fingerprint } | null = null;
  /** Build in progress; concurrent callers share it, so `reading` has one writer. */
  private pending: Promise<CypressMcpConfig> | null = null;
  /** Files read while building the config being loaded, with their stamp at read time */
  private reading: Fingerprint = new Map();

  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolved config. Cached, but rebuilt as soon as any file it was built from
   * (Cypress config, its relative imports, the support file,
   * cypress-mcp.config.json) changes, appears or disappears, so edits made
   * during a session apply to the next tool call.
   */
  async load(): Promise<CypressMcpConfig> {
    if (this.cached && (await this.isUnchanged(this.cached.fingerprint))) {
      return this.cached.config;
    }

    this.pending ??= this.rebuild().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async rebuild(): Promise<CypressMcpConfig> {
    // Stamp every candidate file first, so creating a config file that did
    // not exist yet also invalidates the cache.
    this.reading = new Map();
    for (const file of [SERVER_CONFIG_FILE, ...CYPRESS_CONFIG_FILES]) {
      const absolute = path.join(this.projectRoot, file);
      this.reading.set(absolute, await stamp(absolute));
    }

    const config = await this.build();
    this.cached = { config, fingerprint: this.reading };
    return config;
  }

  private async isUnchanged(fingerprint: Fingerprint): Promise<boolean> {
    for (const [file, previous] of fingerprint) {
      if ((await stamp(file)) !== previous) {
        this.logger.info("Config input changed, reloading", { file });
        return false;
      }
    }
    return true;
  }

  /** Read a file and remember its stamp, taken before the read. */
  private async readTracked(absolute: string): Promise<string> {
    this.reading.set(absolute, await stamp(absolute));
    return fs.readFile(absolute, "utf-8");
  }

  private async build(): Promise<CypressMcpConfig> {
    const serverConfig = await this.loadServerConfig();
    const configFile = await this.findCypressConfig(serverConfig?.cypressConfigFile);
    if (!configFile) {
      throw new ConfigNotFoundError(this.projectRoot);
    }

    const configHints = await this.loadConfigHints(configFile);

    const config: CypressMcpConfig = {
      projectRoot: normalizePath(this.projectRoot),
      cypressConfigFile: normalizePath(configFile),
      // Only an explicit choice is passed on: Cypress picks its own default
      // (the project's config, then Electron) when --browser is absent.
      ...(serverConfig?.defaultBrowser
        ? { defaultBrowser: serverConfig.defaultBrowser }
        : {}),
      defaultTimeout: serverConfig?.defaultTimeout ?? DEFAULT_CONFIG.defaultTimeout,
      screenshotsDir:
        serverConfig?.screenshotsDir ??
        configHints.screenshotsDir ??
        DEFAULT_CONFIG.screenshotsDir,
      downloadsDir:
        serverConfig?.downloadsDir ??
        configHints.downloadsDir ??
        DEFAULT_CONFIG.downloadsDir,
      specPattern: normalizePatterns(
        serverConfig?.specPattern ??
          configHints.specPattern ??
          DEFAULT_CONFIG.specPattern,
      ),
      supportFile: serverConfig?.supportFile ?? configHints.supportFile,
      titleFilterSupport:
        serverConfig?.titleFilterSupport ??
        (await this.detectTitleFilterSupport(configFile, configHints.supportFile)),
      failureContext: serverConfig?.failureContext ?? DEFAULT_CONFIG.failureContext,
      // Same precedence as Cypress itself: env var over config file
      projectId:
        serverConfig?.projectId ??
        nonEmpty(process.env["CYPRESS_PROJECT_ID"]) ??
        configHints.projectId,
    };

    this.logger.info("Config loaded", {
      configFile,
      projectRoot: this.projectRoot,
    });

    return config;
  }

  private async findCypressConfig(override?: string): Promise<string | null> {
    if (override) {
      const fullPath = path.isAbsolute(override)
        ? override
        : path.join(this.projectRoot, override);

      try {
        await fs.access(fullPath);
        this.reading.set(fullPath, await stamp(fullPath));
        return path.isAbsolute(override)
          ? normalizePath(path.relative(this.projectRoot, fullPath))
          : normalizePath(override);
      } catch {
        throw new ConfigNotFoundError(this.projectRoot, override);
      }
    }

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
      const raw = await this.readTracked(configPath);
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

  private async loadConfigHints(configFile: string): Promise<ConfigHints> {
    const visited = new Set<string>();
    return this.loadConfigHintsFromFile(configFile, visited, 0);
  }

  private async loadConfigHintsFromFile(
    filePath: string,
    visited: Set<string>,
    depth: number,
  ): Promise<ConfigHints> {
    if (depth > 4) {
      return {};
    }

    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);
    const normalized = normalizePath(absolute);

    if (visited.has(normalized)) {
      return {};
    }

    visited.add(normalized);

    let content = "";
    try {
      content = await this.readTracked(absolute);
    } catch {
      return {};
    }

    let mergedHints = extractConfigHints(content);

    for (const importedFile of resolveRelativeImports(absolute, content)) {
      const importedHints = await this.loadConfigHintsFromFile(
        importedFile,
        visited,
        depth + 1,
      );
      mergedHints = mergeConfigHints(mergedHints, importedHints);
    }

    return mergedHints;
  }

  private async detectTitleFilterSupport(
    configFile: string,
    supportFile?: string | false,
  ): Promise<boolean> {
    const filesToScan = new Set<string>();
    const configAbsolute = path.isAbsolute(configFile)
      ? configFile
      : path.join(this.projectRoot, configFile);

    filesToScan.add(normalizePath(configAbsolute));

    try {
      const configContent = await this.readTracked(configAbsolute);
      for (const importedFile of resolveRelativeImports(configAbsolute, configContent)) {
        filesToScan.add(normalizePath(importedFile));
      }
    } catch {
      // Ignore and continue with best-effort scanning.
    }

    if (typeof supportFile === "string") {
      const supportAbsolute = path.isAbsolute(supportFile)
        ? supportFile
        : path.join(this.projectRoot, supportFile);
      filesToScan.add(normalizePath(supportAbsolute));
    } else if (supportFile === undefined) {
      // Not set in the config: Cypress uses its default support file.
      for (const candidate of DEFAULT_SUPPORT_FILES) {
        filesToScan.add(normalizePath(path.join(this.projectRoot, candidate)));
      }
    }

    for (const file of filesToScan) {
      try {
        // Tracked so that wiring @cypress/grep into the support file mid
        // session enables cypress_run_test without a restart.
        const content = await this.readTracked(file);
        if (TITLE_FILTER_PATTERN.test(content)) {
          return true;
        }
      } catch {
        // Ignore unreadable files while probing for grep support.
      }
    }

    return false;
  }
}

/** "size:mtime" of a file, or "missing". */
async function stamp(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

interface ConfigHints {
  readonly projectId?: string;
  readonly specPattern?: readonly string[];
  readonly supportFile?: string | false;
  readonly screenshotsDir?: string;
  readonly downloadsDir?: string;
}

/** Cypress's default e2e support file, `cypress/support/e2e.{js,jsx,ts,tsx}`. */
const DEFAULT_SUPPORT_FILES = ["js", "jsx", "ts", "tsx"].map(
  (ext) => `cypress/support/e2e.${ext}`,
);

const TITLE_FILTER_PATTERN =
  /(@cypress\/grep|cypress-grep|registerCypressGrep|grepFilterSpecs|grepOmitFiltered)/;

function normalizePatterns(value: string | readonly string[]): string[] {
  const patterns = Array.isArray(value) ? value : [value];
  return patterns.map((pattern) => normalizePath(pattern));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function extractConfigHints(content: string): ConfigHints {
  return {
    projectId: extractSingleString(content, "projectId"),
    specPattern: extractStringList(content, "specPattern"),
    supportFile: extractSupportFile(content),
    screenshotsDir:
      extractSingleString(content, "screenshotsFolder") ??
      extractSingleString(content, "screenshotsDir"),
    downloadsDir:
      extractSingleString(content, "downloadsFolder") ??
      extractSingleString(content, "downloadsDir"),
  };
}

function extractStringList(content: string, key: string): readonly string[] | undefined {
  const arrayPattern = new RegExp(`${key}\\s*:\\s*\\[(.*?)\\]`, "s");
  const arrayMatch = arrayPattern.exec(content);
  if (arrayMatch?.[1]) {
    const values = Array.from(
      arrayMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g),
      (match) => match[1],
    ).filter((value): value is string => typeof value === "string");

    if (values.length > 0) {
      return values;
    }
  }

  const singleValue = extractSingleString(content, key);
  return singleValue ? [singleValue] : undefined;
}

function extractSupportFile(content: string): string | false | undefined {
  const disabledPattern = /supportFile\s*:\s*false/;
  if (disabledPattern.test(content)) {
    return false;
  }

  return extractSingleString(content, "supportFile");
}

function extractSingleString(content: string, key: string): string | undefined {
  const pattern = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
  const match = pattern.exec(content);
  return match?.[1];
}

function resolveRelativeImports(absolutePath: string, content: string): string[] {
  const imports = new Set<string>();
  const importPatterns = [
    /import\s+[^'"]*?from\s*["'](\.[^"']+)["']/g,
    /import\s*["'](\.[^"']+)["']/g,
    /export\s+[^'"]*?from\s*["'](\.[^"']+)["']/g,
    /require\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];

  for (const pattern of importPatterns) {
    for (const match of content.matchAll(pattern)) {
      const importPath = match[1];
      if (importPath) {
        const resolved = resolveImportPath(path.dirname(absolutePath), importPath);
        if (resolved) {
          imports.add(resolved);
        }
      }
    }
  }

  return [...imports];
}

function resolveImportPath(baseDir: string, importPath: string): string | null {
  const candidates = path.extname(importPath)
    ? [importPath]
    : [
        `${importPath}.ts`,
        `${importPath}.js`,
        `${importPath}.mjs`,
        `${importPath}.cjs`,
        path.join(importPath, "index.ts"),
        path.join(importPath, "index.js"),
      ];

  for (const candidate of candidates) {
    const absolute = path.resolve(baseDir, candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  return null;
}

function mergeConfigHints(primary: ConfigHints, fallback: ConfigHints): ConfigHints {
  return {
    projectId: primary.projectId ?? fallback.projectId,
    specPattern: primary.specPattern ?? fallback.specPattern,
    supportFile: primary.supportFile ?? fallback.supportFile,
    screenshotsDir: primary.screenshotsDir ?? fallback.screenshotsDir,
    downloadsDir: primary.downloadsDir ?? fallback.downloadsDir,
  };
}
