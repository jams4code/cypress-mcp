// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Monorepos: the server root (--cwd) may hold several Cypress projects, each
// in a folder with its own cypress.config.*. A tool finds its project from the
// `project` argument, from the spec path, or alone when there is only one.
// Paths shown to the agent stay relative to the server root.
import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import type { ToolContext } from "../types/index.js";
import { CYPRESS_CONFIG_FILES } from "../types/config.js";
import { CypressMcpError, InvalidArgumentError } from "../utils/errors.js";
import { normalizePath, resolveInsideRoot } from "../utils/paths.js";

/** Config files that mark a project folder. */
const PROJECT_MARKERS: readonly string[] = CYPRESS_CONFIG_FILES;
const DISCOVERY_DEPTH = 5;

export class ProjectRequiredError extends CypressMcpError {
  constructor(projects: readonly string[]) {
    super(
      projects.length === 0
        ? "No cypress.config.* in the server root or its subfolders."
        : `The server root holds several Cypress projects: ${projects.join(", ")}. Pass project, or a spec path inside one of them.`,
      projects.length === 0 ? "CONFIG_NOT_FOUND" : "PROJECT_REQUIRED",
      projects.length === 0
        ? "Start the server with --cwd set to the folder that holds cypress.config.*."
        : "Set project to one of the folders listed.",
    );
    this.name = "ProjectRequiredError";
  }
}

export interface ProjectSelection {
  readonly ctx: ToolContext;
  /** Project folder relative to the server root, "" for the root itself */
  readonly prefix: string;
  /** The given spec arguments, made relative to the project */
  readonly specs: string[];
}

export class ProjectRegistry {
  private readonly contexts = new Map<string, ToolContext>();

  constructor(
    readonly serverRoot: string,
    private readonly create: (projectRoot: string) => ToolContext,
  ) {}

  /** The context of a project folder (absolute), created on first use. */
  context(projectRoot: string): ToolContext {
    const key = path.resolve(projectRoot);
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = this.create(key);
      this.contexts.set(key, ctx);
    }
    return ctx;
  }

  /** Every context created so far, to stop their runs on shutdown. */
  all(): ToolContext[] {
    return [...this.contexts.values()];
  }

  /**
   * The project a call is about. `project` wins; then the server root when it
   * has a config (the common case, unchanged since 0.1); then the folder of
   * the first spec path that has a config; then the only project found.
   */
  async select(input: {
    project?: string;
    specs?: readonly string[];
  }): Promise<ProjectSelection> {
    const specs = [...(input.specs ?? [])];

    if (input.project !== undefined && input.project.trim() !== "") {
      const root = resolveInsideRoot(this.serverRoot, input.project.trim());
      if (!root || !hasConfig(root)) {
        throw new InvalidArgumentError(
          `project must be a folder inside the server root that holds a cypress.config.*: ${input.project}. Found: ${(await this.discover()).join(", ") || "none"}.`,
        );
      }
      return this.selection(root, specs);
    }

    if (hasConfig(this.serverRoot)) {
      return this.selection(this.serverRoot, specs);
    }

    for (const spec of specs) {
      const fromSpec = this.projectOfPath(spec.replace(/:\d+(?::\d+)?$/, ""));
      if (fromSpec) {
        return this.selection(fromSpec, specs);
      }
    }

    const projects = await this.discover();
    if (projects.length === 1) {
      return this.selection(path.join(this.serverRoot, projects[0]!), specs);
    }
    throw new ProjectRequiredError(projects);
  }

  /** Project folders under the server root, relative, "." for the root. */
  async discover(): Promise<string[]> {
    const configs = await glob(
      PROJECT_MARKERS.map((file) => `**/${file}`),
      {
        cwd: this.serverRoot,
        ignore: ["**/node_modules/**", "**/.git/**"],
        deep: DISCOVERY_DEPTH,
      },
    );
    return [...new Set(configs.map((file) => normalizePath(path.dirname(file))))].sort();
  }

  private selection(projectRoot: string, specs: string[]): ProjectSelection {
    const prefix = normalizePath(path.relative(this.serverRoot, projectRoot));
    return {
      ctx: this.context(projectRoot),
      prefix,
      specs: specs.map((spec) => toProjectRelative(spec, prefix)),
    };
  }

  /** Nearest folder above a server-root-relative path that holds a config. */
  private projectOfPath(relative: string): string | undefined {
    const absolute = resolveInsideRoot(this.serverRoot, relative);
    if (!absolute) return undefined;
    let current = path.dirname(absolute);
    while (current.startsWith(this.serverRoot) && current !== this.serverRoot) {
      if (hasConfig(current)) return current;
      current = path.dirname(current);
    }
    return undefined;
  }
}

function hasConfig(dir: string): boolean {
  return PROJECT_MARKERS.some((file) => existsSync(path.join(dir, file)));
}

/** `apps/web/cypress/e2e/a.cy.ts` to `cypress/e2e/a.cy.ts` for project `apps/web`. */
function toProjectRelative(spec: string, prefix: string): string {
  if (!prefix) return spec;
  const normalized = normalizePath(spec.trim());
  return normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length + 1) : spec;
}

/** A project-relative path as the agent sees it, relative to the server root. */
export function displayPath(prefix: string, projectRelative: string): string {
  return prefix ? path.posix.join(prefix, projectRelative) : projectRelative;
}
