import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SERVER_INSTRUCTIONS } from "../../src/server.js";
import { DEFAULT_TOOLS } from "../../src/caps.js";

describe("server instructions", () => {
  it("are five lines that name every default tool", () => {
    expect(SERVER_INSTRUCTIONS.split("\n")).toHaveLength(5);
    for (const tool of DEFAULT_TOOLS) {
      expect(SERVER_INSTRUCTIONS).toContain(tool);
    }
    // Claude Code cuts server instructions at 4,096 characters.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(1_000);
  });

  it("are quoted as they are in skill/SKILL.md", () => {
    expect(readFileSync("skill/SKILL.md", "utf-8")).toContain(SERVER_INSTRUCTIONS);
  });
});
