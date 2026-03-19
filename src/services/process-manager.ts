import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import treeKill from "tree-kill";
import type { CypressRunArgs } from "../types/cypress.js";
import { CypressNotFoundError, TimeoutError } from "../utils/errors.js";
import { resolveCypressBin, needsShell } from "../utils/paths.js";
import type { Logger } from "../utils/logger.js";

interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export class ProcessManager {
  private runQueue: Promise<void> = Promise.resolve();
  private activeProcess: ChildProcess | null = null;

  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
  ) {}

  async run(args: CypressRunArgs): Promise<SpawnResult> {
    // Serial execution: queue behind any active run
    return new Promise<SpawnResult>((resolve, reject) => {
      this.runQueue = this.runQueue
        .then(() => this.executeRun(args))
        .then(resolve, reject);
    });
  }

  async verify(): Promise<SpawnResult> {
    const bin = await this.findBinary();
    return this.spawnProcess(bin, ["verify"], 60_000);
  }

  async install(): Promise<SpawnResult> {
    const bin = await this.findBinary();
    return this.spawnProcess(bin, ["install"], 120_000);
  }

  abort(): void {
    if (this.activeProcess?.pid) {
      this.logger.info("Aborting active Cypress process", {
        pid: this.activeProcess.pid,
      });
      treeKill(this.activeProcess.pid, "SIGTERM");
      this.activeProcess = null;
    }
  }

  isRunning(): boolean {
    return this.activeProcess !== null;
  }

  private async executeRun(args: CypressRunArgs): Promise<SpawnResult> {
    const bin = await this.findBinary();
    const cliArgs = this.buildArgs(args);
    const timeout = args.timeout ?? 300_000;

    this.logger.info("Running Cypress", {
      spec: args.spec,
      browser: args.browser,
      timeout,
    });

    return this.spawnProcess(bin, cliArgs, timeout);
  }

  private buildArgs(args: CypressRunArgs): string[] {
    const cliArgs = ["run", "--reporter", "json", "--spec", args.spec];

    if (args.browser) {
      cliArgs.push("--browser", args.browser);
    }

    if (args.headed) {
      cliArgs.push("--headed");
    }

    if (args.grep) {
      cliArgs.push("--env", `grep="${args.grep}"`);
    }

    if (args.env) {
      const envPairs = Object.entries(args.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      if (envPairs) {
        cliArgs.push("--env", envPairs);
      }
    }

    return cliArgs;
  }

  private async findBinary(): Promise<string> {
    const localBin = resolveCypressBin(this.projectRoot);
    try {
      await fs.access(localBin);
      return localBin;
    } catch {
      // Try npx fallback
      const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
      return npxBin;
    }
  }

  private spawnProcess(
    bin: string,
    args: string[],
    timeout: number,
  ): Promise<SpawnResult> {
    // If using npx fallback, prepend "cypress" to args
    const finalArgs = bin.includes("npx") ? ["cypress", ...args] : args;
    const useShell = needsShell(bin);

    return new Promise<SpawnResult>((resolve, reject) => {
      const child = spawn(bin, finalArgs, {
        cwd: this.projectRoot,
        shell: useShell,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.activeProcess = child;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        if (child.pid) {
          this.logger.warn("Cypress process timed out, killing", {
            pid: child.pid,
            timeout,
          });
          treeKill(child.pid, "SIGTERM", () => {
            // If still alive after 5s, force kill
            setTimeout(() => {
              if (child.pid) {
                treeKill(child.pid, "SIGKILL");
              }
            }, 5000);
          });
        }
        reject(new TimeoutError(timeout));
      }, timeout);

      child.on("close", (exitCode) => {
        clearTimeout(timer);
        this.activeProcess = null;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          exitCode,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        this.activeProcess = null;
        if (err.message.includes("ENOENT")) {
          reject(new CypressNotFoundError(this.projectRoot));
        } else {
          reject(err);
        }
      });
    });
  }
}
