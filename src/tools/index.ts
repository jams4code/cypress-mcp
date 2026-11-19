// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../types/index.js";
import type { Capability } from "../caps.js";

// Default loop: list_specs -> run -> get_failure -> fix -> run again.
//
// Tool names must never collide with Cypress Cloud MCP's (cypress_get_runs,
// cypress_get_specs, cypress_get_tests, ...): agents often load both servers.
// test/unit/cloud-compat.test.ts enforces this.
import { register as run } from "./run.js";
import { register as getFailure } from "./get-failure.js";
import { register as listSpecs } from "./core/list-specs.js";
import { register as doctor } from "./project/doctor.js";

// --caps analyze
import { register as analyzeSpec } from "./discovery/analyze-spec.js";

// --caps config
import { register as getConfig } from "./core/get-config.js";
import { register as getEnv } from "./setup/get-env.js";

// --caps legacy: the 0.2.x names, deprecated, removed in 0.5
import { register as discover } from "./discovery/discover.js";
import { register as runSpec } from "./core/run-spec.js";
import { register as runTest } from "./core/run-test.js";
import { register as rerunLast } from "./core/rerun-last.js";
import { register as getLastRun } from "./debug/get-last-run.js";
import { register as getFailureContext } from "./debug/get-failure-context.js";
import { register as getScreenshot } from "./debug/get-screenshot.js";

type Register = (server: McpServer, ctx: ToolContext) => void;

const GROUPS: Readonly<Record<Capability, readonly Register[]>> = {
  analyze: [analyzeSpec],
  config: [getConfig, getEnv],
  legacy: [
    discover,
    runSpec,
    runTest,
    rerunLast,
    getLastRun,
    getFailureContext,
    getScreenshot,
  ],
};

/**
 * Registers the default tools, then each enabled group. The order is fixed so
 * tools/list is the same on every call, which keeps clients' prompt caches warm.
 */
export function registerAllTools(
  server: McpServer,
  ctx: ToolContext,
  caps: ReadonlySet<Capability> = new Set(),
): void {
  run(server, ctx);
  getFailure(server, ctx);
  listSpecs(server, ctx);
  doctor(server, ctx);

  for (const cap of ["analyze", "config", "legacy"] as const) {
    if (caps.has(cap)) {
      for (const register of GROUPS[cap]) register(server, ctx);
    }
  }
}
