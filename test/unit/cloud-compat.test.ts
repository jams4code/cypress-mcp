import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAllTools } from "../../src/tools/index.js";
import { CAPABILITIES, DEFAULT_TOOLS, type Capability } from "../../src/caps.js";
import { cloudCheck } from "../../src/tools/project/doctor.js";
import type { ToolContext } from "../../src/types/index.js";

/**
 * Tools exposed by Cypress Cloud MCP (https://docs.cypress.io/cloud/integrations/cloud-mcp).
 * Agents commonly load both servers, and some clients do not namespace tool
 * names per server, so a shared name would shadow one of the two tools.
 */
const CLOUD_MCP_TOOLS = [
  "cypress_get_projects",
  "cypress_get_runs",
  "cypress_get_specs",
  "cypress_get_tests",
  "cypress_get_failed_tests",
  "cypress_get_flaky_tests",
  "cypress_get_test_screenshots",
  "cypress_get_accessibility_report",
  "cypress_get_accessibility_views",
  "cypress_get_accessibility_rule_failures",
  "cypress_get_ui_coverage_report",
  "cypress_get_ui_coverage_views",
  "cypress_get_ui_coverage_elements",
  "submit_mcp_feedback",
];

function registeredToolNames(
  caps: Capability[] = ["analyze", "config", "legacy"],
): string[] {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => names.push(name),
  } as unknown as McpServer;
  registerAllTools(server, {} as ToolContext, new Set(caps));
  return names;
}

describe("Cypress Cloud MCP compatibility", () => {
  it("shares no tool name with Cypress Cloud MCP", () => {
    const names = registeredToolNames();

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => CLOUD_MCP_TOOLS.includes(name))).toEqual([]);
  });

  it("registers each tool name once", () => {
    const names = registeredToolNames();

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("tool sets", () => {
  it("registers only the four loop tools by default", () => {
    expect(registeredToolNames([])).toEqual([...DEFAULT_TOOLS]);
  });

  it("adds each capability's tools, in a fixed order", () => {
    for (const [cap, tools] of Object.entries(CAPABILITIES)) {
      expect(registeredToolNames([cap as Capability])).toEqual([
        ...DEFAULT_TOOLS,
        ...tools,
      ]);
    }
    // The order does not depend on the order caps were given in.
    expect(registeredToolNames(["legacy", "analyze", "config"])).toEqual(
      registeredToolNames(["analyze", "config", "legacy"]),
    );
  });
});

describe("doctor cloudCheck", () => {
  it("treats a project without Cloud as healthy", () => {
    expect(cloudCheck(undefined, false).status).toBe("ok");
  });

  it("is ready when projectId and record key are both present", () => {
    const check = cloudCheck("abc123", true);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("abc123");
  });

  it("warns on a half-configured setup", () => {
    expect(cloudCheck("abc123", false).status).toBe("warn");
    expect(cloudCheck(undefined, true).status).toBe("warn");
  });
});
