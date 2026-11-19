// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Each run gets its own folder under <project>/node_modules/.cache/cypress-mcp/
// runs/. It holds what Cypress writes for the run (reports, screenshots, the
// failure context) and, unless failure context is off, a wrapper config that
// imports the project's cypress.config.* unchanged. Nothing outside
// node_modules/.cache is written, and two servers on one project never share
// a screenshots folder.
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPORTER_PATH, RUNTIME_DIR } from "../package-paths.js";
import type { MochaJsonReport } from "../types/cypress.js";
import type { Logger } from "../utils/logger.js";

/** Read by reporter/cypress-mcp-reporter.cjs. Keep in sync with RUN_DIR_ENV there. */
export const RUN_DIR_ENV = "MCP_CYPRESS_RUN_DIR";

/** Keep in sync with CONTEXT_TASK in runtime/config.cjs. */
export const CONTEXT_TASK = "cypressMcp:failureContext";

export const RUNS_DIR = path.join("node_modules", ".cache", "cypress-mcp", "runs");

/** Run folders kept per project; the read tools keep about as many runs. */
const KEEP_RUN_DIRS = 50;
/** A folder younger than this may belong to a run in progress (another server). */
const MIN_AGE_TO_DELETE_MS = 30 * 60_000;

/** Outline size the browser runtime keeps: about 3,000 tokens. */
export const MAX_OUTLINE_CHARS = 12_000;

export interface RunWorkspace {
  readonly dir: string;
  readonly screenshotsDir: string;
  readonly videosDir: string;
  readonly reportsDir: string;
  readonly contextFile: string;
  /** Wrapper config, project relative, when failure context is on */
  readonly wrapperConfigFile?: string;
}

export interface WorkspaceOptions {
  /** The project's Cypress config file, project relative */
  readonly configFile: string;
  /** Installed Cypress version: it decides how a TypeScript config is loaded */
  readonly cypressVersion?: string;
  /** Write the wrapper config (failure context, title filter, repeat) */
  readonly wrap: boolean;
  readonly titles?: readonly string[];
  readonly contains?: string;
  readonly repeat?: number;
}

/** A report file written by the reporter: Mocha's json report plus the spec. */
export interface SpecReport extends MochaJsonReport {
  readonly spec?: string;
}

/** One failed attempt, as runtime/support.js sends it through the task. */
export interface ContextPayload {
  readonly spec?: string;
  readonly title: string;
  readonly attempt?: number;
  readonly url?: string | null;
  readonly pageTitle?: string | null;
  readonly failedSelector?: string | null;
  readonly matches?: number | null;
  readonly outline?: string;
  readonly outlineTruncated?: boolean;
  readonly inventory?: readonly string[];
  readonly console?: readonly { level: string; text: string }[];
  readonly network?: readonly { method: string; url: string; status: number | string }[];
  readonly commands?: readonly { name: string; message: string; state: string }[];
}

export async function prepareWorkspace(
  projectRoot: string,
  runToken: string,
  options: WorkspaceOptions,
): Promise<RunWorkspace> {
  const dir = path.join(projectRoot, RUNS_DIR, runToken);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const workspace: RunWorkspace = {
    dir,
    screenshotsDir: path.join(dir, "screenshots"),
    videosDir: path.join(dir, "videos"),
    reportsDir: path.join(dir, "reports"),
    contextFile: path.join(dir, "context.jsonl"),
  };
  if (!options.wrap) {
    return workspace;
  }

  const userConfig = path.resolve(projectRoot, options.configFile);
  const kind = moduleKind(userConfig, typescriptLoader(options.cypressVersion));

  await fs.copyFile(
    path.join(RUNTIME_DIR, "config.cjs"),
    path.join(dir, "cypress-mcp-runtime.cjs"),
  );
  const supportRuntime = path.join(dir, "support-runtime.js");
  const browserOptions = {
    task: CONTEXT_TASK,
    filter: {
      ...(options.titles && options.titles.length > 0 ? { titles: options.titles } : {}),
      ...(options.contains !== undefined ? { contains: options.contains } : {}),
    },
    repeat: options.repeat ?? 1,
    maxOutlineChars: MAX_OUTLINE_CHARS,
  };
  await fs.writeFile(
    supportRuntime,
    `globalThis.__cypressMcp = ${JSON.stringify(browserOptions)};\n${await fs.readFile(
      path.join(RUNTIME_DIR, "support.js"),
      "utf-8",
    )}`,
  );
  // Anchors how Node and tsx read the wrapper (and .js files here): the same
  // module type as the project's config.
  await fs.writeFile(
    path.join(dir, "package.json"),
    `${JSON.stringify({ private: true, type: kind.esm ? "module" : "commonjs" })}\n`,
  );

  const wrapperOptions = {
    projectRoot,
    runDir: dir,
    reporterPath: REPORTER_PATH,
    contextFile: workspace.contextFile,
    supportRuntime,
  };
  const wrapperFile = path.join(dir, `cypress-mcp.config${kind.wrapperExtension}`);
  await fs.writeFile(
    wrapperFile,
    wrapperSource(importPath(dir, userConfig), wrapperOptions, kind.syntax),
  );

  return {
    ...workspace,
    wrapperConfigFile: path.relative(projectRoot, wrapperFile).split(path.sep).join("/"),
  };
}

interface ModuleKind {
  readonly esm: boolean;
  readonly wrapperExtension: string;
  /** `import` for ESM and TypeScript (tsx compiles it either way), `require` for .cjs */
  readonly syntax: "import" | "require";
}

/**
 * How Cypress compiles a TypeScript config: tsx from Cypress 15, ts-node
 * before. ts-node, as Cypress registers it, skips files under node_modules,
 * so with it the wrapper must be JavaScript (the project's own .ts config,
 * outside node_modules, is still compiled). Exported for tests.
 */
export function typescriptLoader(cypressVersion: string | undefined): "tsx" | "ts-node" {
  const major = Number.parseInt(cypressVersion ?? "", 10);
  return Number.isFinite(major) && major < 15 ? "ts-node" : "tsx";
}

/**
 * How Cypress loads the project's config, mirrored for the wrapper so the
 * wrapper can import it without crossing module systems: .mjs/.mts are ES
 * modules, .cjs/.cts CommonJS, .js/.ts follow the nearest package.json.
 * Exported for tests.
 */
export function moduleKind(
  configFile: string,
  tsLoader: "tsx" | "ts-node" = "tsx",
): ModuleKind {
  const ext = path.extname(configFile);
  const esm =
    ext === ".mjs" || ext === ".mts"
      ? true
      : ext === ".cjs" || ext === ".cts"
        ? false
        : nearestPackageType(path.dirname(configFile)) === "module";

  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      if (tsLoader === "ts-node") {
        return esm
          ? { esm, wrapperExtension: ".mjs", syntax: "import" }
          : { esm, wrapperExtension: ".cjs", syntax: "require" };
      }
      return { esm, wrapperExtension: ext, syntax: "import" };
    case ".mjs":
      return { esm: true, wrapperExtension: ".mjs", syntax: "import" };
    case ".cjs":
      return { esm: false, wrapperExtension: ".cjs", syntax: "require" };
    default:
      return esm
        ? { esm, wrapperExtension: ".mjs", syntax: "import" }
        : { esm, wrapperExtension: ".cjs", syntax: "require" };
  }
}

/** "type" of the nearest package.json, as Node looks it up. */
function nearestPackageType(dir: string): string | undefined {
  let current = dir;
  for (;;) {
    const file = path.join(current, "package.json");
    if (existsSync(file)) {
      try {
        return (JSON.parse(readFileSync(file, "utf-8")) as { type?: string }).type;
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/** Exported for tests. */
export function wrapperSource(
  userConfigImport: string,
  options: Record<string, string>,
  syntax: "import" | "require",
): string {
  const header =
    "// Written by cypress-mcp for one run. It loads the project's Cypress config\n" +
    "// unchanged and adds failure context; see runtime/config.cjs in cypress-mcp.\n";
  const args = JSON.stringify(options, null, 2);
  if (syntax === "require") {
    return (
      `${header}const loaded = require(${JSON.stringify(userConfigImport)});\n` +
      `const runtime = require("./cypress-mcp-runtime.cjs");\n` +
      `module.exports = runtime.wrapConfig(loaded && loaded.default ? loaded.default : loaded, ${args});\n`
    );
  }
  return (
    `${header}import userConfig from ${JSON.stringify(userConfigImport)};\n` +
    `import runtime from "./cypress-mcp-runtime.cjs";\n\n` +
    `export default runtime.wrapConfig(userConfig, ${args});\n`
  );
}

function importPath(fromDir: string, file: string): string {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Reports of the specs that ran, in run order. */
export async function readReports(workspace: RunWorkspace): Promise<SpecReport[]> {
  let files: string[];
  try {
    files = (await fs.readdir(workspace.reportsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const reports: SpecReport[] = [];
  for (const file of files.sort()) {
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(workspace.reportsDir, file), "utf-8"),
      ) as SpecReport;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.tests)) {
        reports.push(parsed);
      }
    } catch {
      // A report cut off by a killed run: the events still describe it.
    }
  }
  return reports;
}

/** Failure context lines the browser runtime sent, oldest first. */
export async function readContexts(workspace: RunWorkspace): Promise<ContextPayload[]> {
  let raw: string;
  try {
    raw = await fs.readFile(workspace.contextFile, "utf-8");
  } catch {
    return [];
  }
  const payloads: ContextPayload[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ContextPayload;
      if (parsed && typeof parsed.title === "string") payloads.push(parsed);
    } catch {
      // Skip a line cut off by a killed run.
    }
  }
  return payloads;
}

/** Every screenshot of the run, oldest first. */
export async function listScreenshots(workspace: RunWorkspace): Promise<string[]> {
  const found: { file: string; mtime: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith(".png")) {
        const stat = await fs.stat(full).catch(() => undefined);
        found.push({ file: full, mtime: stat?.mtimeMs ?? 0 });
      }
    }
  };
  await walk(workspace.screenshotsDir);
  return found.sort((a, b) => a.mtime - b.mtime).map((entry) => entry.file);
}

/**
 * Deletes old run folders: beyond the newest KEEP_RUN_DIRS, and only those
 * untouched for MIN_AGE_TO_DELETE_MS, so another server's run in progress
 * keeps its files.
 */
export async function cleanupWorkspaces(
  projectRoot: string,
  logger: Logger,
): Promise<void> {
  const root = path.join(projectRoot, RUNS_DIR);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const full = path.join(root, entry.name);
        const stat = await fs.stat(full).catch(() => undefined);
        return { full, mtime: stat?.mtimeMs ?? 0 };
      }),
  );
  dirs.sort((a, b) => b.mtime - a.mtime);
  const now = Date.now();
  for (const old of dirs.slice(KEEP_RUN_DIRS)) {
    if (now - old.mtime < MIN_AGE_TO_DELETE_MS) continue;
    await fs.rm(old.full, { recursive: true, force: true }).catch((err: unknown) => {
      logger.warn("Could not delete an old run folder", {
        dir: old.full,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
