import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

const SERVER_PATH = path.resolve("dist/index.js");
const FIXTURE_PATH = path.resolve("test/fixtures/cypress-project");

const EXPECTED_TOOLS = [
  "cypress_discover",
  "cypress_analyze_spec",
  "cypress_list_specs",
  "cypress_run_spec",
  "cypress_run_test",
  "cypress_rerun_last",
  "cypress_get_last_run",
  "cypress_get_failure_context",
  "cypress_get_screenshot",
  "cypress_get_env",
  "cypress_doctor",
] as const;

function sendJsonRpc(
  messages: object[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER_PATH, "--cwd", FIXTURE_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", () => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });

    child.on("error", reject);

    const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    child.stdin.write(input);
    child.stdin.end();

    setTimeout(() => child.kill(), 5000);
  });
}

describe("Server Integration", () => {
  it("should respond to initialize", async () => {
    const { stdout } = await sendJsonRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      },
    ]);

    const lines = stdout.trim().split("\n");
    const response = JSON.parse(lines[0]!);

    expect(response.result.serverInfo.name).toBe("cypress-mcp");
    expect(response.result.serverInfo.version).toBe("0.1.0");
    expect(response.result.capabilities.tools).toBeDefined();
  });

  it("should register exactly 11 tools", async () => {
    const { stdout } = await sendJsonRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const lines = stdout.trim().split("\n");
    const toolsResponse = lines.find((l) => l.includes('"id":2'));
    expect(toolsResponse).toBeDefined();

    const parsed = JSON.parse(toolsResponse!);
    const toolNames = parsed.result.tools.map(
      (t: { name: string }) => t.name,
    );

    expect(toolNames).toHaveLength(EXPECTED_TOOLS.length);
    for (const expected of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expected);
    }
  });
});
