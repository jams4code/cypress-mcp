import { describe, it, expect } from "vitest";
import { CAPABILITIES, parseCaps } from "../../src/caps.js";

describe("parseCaps", () => {
  it("is empty by default", () => {
    const { caps, unknown } = parseCaps(["--cwd", "/p"], {});
    expect([...caps]).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("reads --caps a,b, --caps=a and CYPRESS_MCP_CAPS", () => {
    const { caps } = parseCaps(["--caps", "analyze", "--caps=Legacy"], {
      CYPRESS_MCP_CAPS: " config ",
    });
    expect([...caps].sort()).toEqual(["analyze", "config", "legacy"]);
  });

  it("turns every group on with all", () => {
    const { caps } = parseCaps(["--caps=all"], {});
    expect([...caps].sort()).toEqual(Object.keys(CAPABILITIES).sort());
  });

  it("reports names that are not a capability", () => {
    const { caps, unknown } = parseCaps(["--caps", "vision,config"], {});
    expect([...caps]).toEqual(["config"]);
    expect(unknown).toEqual(["vision"]);
  });
});
