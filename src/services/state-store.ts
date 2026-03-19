import type { CypressRunResult } from "../types/results.js";
import type { CypressRunArgs } from "../types/cypress.js";

let nextId = 1;

export interface RunRecord {
  readonly runId: string;
  readonly kind: "run_spec" | "run_test";
  readonly spec: string;
  readonly args: CypressRunArgs;
  readonly result: CypressRunResult;
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly timestamp: number;
}

export class StateStore {
  private lastRun: RunRecord | null = null;
  private screenshotIndex = new Map<string, string[]>();

  recordRun(
    kind: "run_spec" | "run_test",
    spec: string,
    args: CypressRunArgs,
    result: CypressRunResult,
    stdout: string,
    stderr: string,
  ): RunRecord {
    const record: RunRecord = {
      runId: `run_${nextId++}`,
      kind,
      spec,
      args,
      result,
      stdoutTail: stdout.slice(-2000),
      stderrTail: stderr.slice(-2000),
      timestamp: Date.now(),
    };

    this.lastRun = record;

    if (result.screenshots.length > 0) {
      this.screenshotIndex.set(spec, [...result.screenshots]);
    }

    return record;
  }

  getLastRun(): RunRecord | null {
    return this.lastRun;
  }

  getScreenshots(spec?: string): string[] {
    if (spec) {
      return this.screenshotIndex.get(spec) ?? [];
    }
    return this.lastRun?.result.screenshots.slice() ?? [];
  }

  clear(): void {
    this.lastRun = null;
    this.screenshotIndex.clear();
    nextId = 1;
  }
}
