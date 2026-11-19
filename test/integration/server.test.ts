// The server as a client sees it at startup: identity, capabilities,
// instructions and the tool list, for 2025 clients (initialize) and
// 2026-07-28 clients (per-request metadata). Needs `npm run build` first.
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client as ModernClient } from "@modelcontextprotocol/client";
import { StdioClientTransport as ModernStdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER_PATH = path.resolve("dist/index.js");
const FIXTURE_PATH = path.resolve("test/fixtures/cypress-project");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(path.resolve("package.json"), "utf-8")) as { version: string }
).version;

const DEFAULT_TOOLS = [
  "cypress_run",
  "cypress_get_failure",
  "cypress_list_specs",
  "cypress_doctor",
];

const ALL_TOOLS = [
  ...DEFAULT_TOOLS,
  "cypress_analyze_spec",
  "cypress_get_config",
  "cypress_get_env",
  "cypress_discover",
  "cypress_run_spec",
  "cypress_run_test",
  "cypress_rerun_last",
  "cypress_get_last_run",
  "cypress_get_failure_context",
  "cypress_get_screenshot",
];

const READ_TOOLS = new Set([
  "cypress_get_failure",
  "cypress_list_specs",
  "cypress_doctor",
  "cypress_analyze_spec",
  "cypress_get_config",
  "cypress_get_env",
  "cypress_discover",
  "cypress_get_last_run",
  "cypress_get_failure_context",
  "cypress_get_screenshot",
]);

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CYPRESS_MCP_CAPS") env[key] = value;
  }
  return env;
}

async function connect(...extraArgs: string[]): Promise<Client> {
  const client = new Client({ name: "server-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH, "--cwd", FIXTURE_PATH, ...extraArgs],
      env: serverEnv(),
      stderr: "ignore",
    }),
  );
  return client;
}

function sendJsonRpc(messages: object[]): Promise<{ stdout: string; stderr: string }> {
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
    // Keep stdin open briefly: the server drops requests still in flight
    // when its input ends.
    setTimeout(() => child.stdin.end(), 1000);
    setTimeout(() => child.kill(), 5000);
  });
}

describe("Server Integration", () => {
  it("answers initialize with its identity, instructions and no listChanged", async () => {
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

    const response = JSON.parse(stdout.trim().split("\n")[0]!);

    expect(response.result.serverInfo.name).toBe("cypress-mcp");
    expect(response.result.serverInfo.version).toBe(PACKAGE_VERSION);
    // No notifications/tools/list_changed is ever sent, so it is not advertised.
    expect(response.result.capabilities.tools).toEqual({ listChanged: false });
    const instructions = response.result.instructions as string;
    expect(instructions.split("\n")).toHaveLength(5);
    expect(instructions).toContain("cypress_run");
  });

  it("lists only the four loop tools by default", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(DEFAULT_TOOLS);
    } finally {
      await client.close();
    }
  });

  it("adds the analyze, config and legacy tools with --caps all, in a fixed order", async () => {
    const client = await connect("--caps", "all");
    try {
      const first = await client.listTools();
      const second = await client.listTools();
      expect(first.tools.map((t) => t.name)).toEqual(ALL_TOOLS);
      expect(second.tools).toEqual(first.tools);
    } finally {
      await client.close();
    }
  });

  it("reads caps from CYPRESS_MCP_CAPS and --caps=", async () => {
    const client = new Client({ name: "server-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_PATH, "--cwd", FIXTURE_PATH, "--caps=analyze"],
        env: { ...serverEnv(), CYPRESS_MCP_CAPS: "config" },
        stderr: "ignore",
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        ...DEFAULT_TOOLS,
        "cypress_analyze_spec",
        "cypress_get_config",
        "cypress_get_env",
      ]);
    } finally {
      await client.close();
    }
  });

  it("gives every tool a title and annotations, and the default tools an outputSchema", async () => {
    const client = await connect("--caps", "all");
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.title, tool.name).toBeTruthy();
        if (READ_TOOLS.has(tool.name)) {
          expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true });
        } else {
          expect(tool.annotations, tool.name).toEqual({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          });
        }
        if (DEFAULT_TOOLS.includes(tool.name)) {
          expect(tool.outputSchema, tool.name).toBeDefined();
        }
      }
    } finally {
      await client.close();
    }
  });

  it("serves 2026-07-28 clients, which skip initialize", async () => {
    const client = new ModernClient(
      { name: "modern", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(
      new ModernStdioClientTransport({
        command: process.execPath,
        args: [SERVER_PATH, "--cwd", FIXTURE_PATH],
        env: serverEnv(),
        stderr: "ignore",
      }),
    );
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(DEFAULT_TOOLS);

      const result = await client.callTool({ name: "cypress_list_specs", arguments: {} });
      expect(result.isError ?? false).toBe(false);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        tool: "cypress_list_specs",
      });
    } finally {
      await client.close();
    }
  });
});
