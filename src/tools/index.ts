// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/index.js";

// Core loop: discover -> run -> inspect -> fix -> rerun
//
// Tool names must never collide with Cypress Cloud MCP's (cypress_get_runs,
// cypress_get_specs, cypress_get_tests, ...): agents often load both servers.
// test/unit/cloud-compat.test.ts enforces this.
import { register as discover } from "./discovery/discover.js";
import { register as analyzeSpec } from "./discovery/analyze-spec.js";
import { register as listSpecs } from "./core/list-specs.js";
import { register as runSpec } from "./core/run-spec.js";
import { register as runTest } from "./core/run-test.js";
import { register as rerunLast } from "./core/rerun-last.js";
import { register as getLastRun } from "./debug/get-last-run.js";
import { register as getFailureContext } from "./debug/get-failure-context.js";
import { register as getScreenshot } from "./debug/get-screenshot.js";

// Environment and setup
import { register as getConfig } from "./core/get-config.js";
import { register as getEnv } from "./setup/get-env.js";
import { register as doctor } from "./project/doctor.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  // Discovery
  discover(server, ctx);
  analyzeSpec(server, ctx);
  listSpecs(server, ctx);

  // Execution
  runSpec(server, ctx);
  runTest(server, ctx);
  rerunLast(server, ctx);

  // Inspection
  getLastRun(server, ctx);
  getFailureContext(server, ctx);
  getScreenshot(server, ctx);

  // Setup
  getConfig(server, ctx);
  getEnv(server, ctx);
  doctor(server, ctx);
}
