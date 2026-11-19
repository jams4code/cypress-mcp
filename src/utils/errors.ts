// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { CompletedTest } from "../services/reporter-events.js";

export class CypressMcpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CypressMcpError";
  }

  toJSON(): Record<string, string> {
    const result: Record<string, string> = {
      error: this.message,
      code: this.code,
    };
    if (this.suggestion) {
      result["suggestion"] = this.suggestion;
    }
    return result;
  }
}

export class CypressNotFoundError extends CypressMcpError {
  constructor(projectRoot: string) {
    super(
      `Cypress binary not found in ${projectRoot}`,
      "CYPRESS_NOT_FOUND",
      "Install Cypress in the project with 'npm install --save-dev cypress', then run cypress_doctor.",
    );
    this.name = "CypressNotFoundError";
  }
}

export class ConfigNotFoundError extends CypressMcpError {
  constructor(projectRoot: string, configuredPath?: string) {
    super(
      configuredPath
        ? `Configured Cypress config file was not found: ${configuredPath}`
        : `No Cypress config file found in ${projectRoot}`,
      "CONFIG_NOT_FOUND",
      configuredPath
        ? "Check cypress-mcp.config.json and make sure the configured file exists."
        : "Create a cypress.config.ts or cypress.config.js file.",
    );
    this.name = "ConfigNotFoundError";
  }
}

export class SpecNotFoundError extends CypressMcpError {
  constructor(spec: string) {
    super(
      `Spec file not found: ${spec}`,
      "SPEC_NOT_FOUND",
      "Check the file path. Use cypress_list_specs to see available specs.",
    );
    this.name = "SpecNotFoundError";
  }
}

/** What a run had done when it was stopped. */
export interface PartialRun {
  /** Full title of the test that had started and not finished */
  readonly runningTest?: string;
  readonly completed: readonly CompletedTest[];
  readonly stdout: string;
  readonly stderr: string;
}

export class TimeoutError extends CypressMcpError {
  constructor(
    timeout: number,
    /** Present when the run had started, so its partial output is kept */
    public readonly partial?: PartialRun,
  ) {
    super(
      partial?.runningTest
        ? `Cypress process timed out after ${timeout}ms while running "${partial.runningTest}"`
        : `Cypress process timed out after ${timeout}ms`,
      "TIMEOUT",
      "Increase the timeout or check if the test is stuck.",
    );
    this.name = "TimeoutError";
  }
}

export class RunCancelledError extends CypressMcpError {
  constructor() {
    super(
      "The run was cancelled by the client and Cypress was stopped.",
      "CANCELLED",
      "Start the run again when needed.",
    );
    this.name = "RunCancelledError";
  }
}

export class BrowserCheckError extends CypressMcpError {
  constructor(detail: string) {
    super(
      `Could not list the browsers Cypress can use (cypress info failed): ${detail}`,
      "BROWSER_CHECK_FAILED",
      "Omit browser to use the project's default browser, or run cypress_doctor.",
    );
    this.name = "BrowserCheckError";
  }
}

export class InvalidArgumentError extends CypressMcpError {
  constructor(message: string) {
    super(message, "INVALID_ARGUMENT", "Fix the argument and call the tool again.");
    this.name = "InvalidArgumentError";
  }
}

export class SpecOutsideProjectError extends CypressMcpError {
  constructor(spec: string) {
    super(
      `Spec path is outside the project root: ${spec}`,
      "SPEC_OUTSIDE_PROJECT",
      "Pass a spec path relative to the project root. Use cypress_list_specs to see available specs.",
    );
    this.name = "SpecOutsideProjectError";
  }
}

export class RecordKeyMissingError extends CypressMcpError {
  constructor() {
    super(
      "Recording to Cypress Cloud requires CYPRESS_RECORD_KEY in the cypress-mcp server environment.",
      "RECORD_KEY_MISSING",
      "Set CYPRESS_RECORD_KEY in the env block of your MCP client config for cypress-mcp. The key is never passed as a tool argument.",
    );
    this.name = "RecordKeyMissingError";
  }
}

export class RunNotFoundError extends CypressMcpError {
  constructor(runId: string, knownRunIds: readonly string[]) {
    super(
      runId === "last"
        ? "No run yet in this server session."
        : `Unknown runId "${runId}". ${
            knownRunIds.length > 0
              ? `Stored runs, newest first: ${knownRunIds.slice(0, 10).join(", ")}.`
              : "No run is stored: the server may have restarted."
          }`,
      "RUN_NOT_FOUND",
      "Start a run with cypress_run and pass the runId it returns.",
    );
    this.name = "RunNotFoundError";
  }
}

/**
 * Wraps an error the server did not expect, so the agent still gets a tool
 * result with isError instead of a protocol error.
 */
export class InternalError extends CypressMcpError {
  constructor(cause: unknown) {
    super(
      `cypress-mcp failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}`,
      "INTERNAL_ERROR",
      "Retry the call. If it keeps failing, report it with the server's stderr log.",
    );
    this.name = "InternalError";
  }
}

export class TitleFilterUnavailableError extends CypressMcpError {
  constructor() {
    super(
      "Running a single test by name needs @cypress/grep (or an equivalent grep plugin) in the Cypress project.",
      "TITLE_FILTER_UNAVAILABLE",
      "Run the whole spec, wire @cypress/grep into the project, or set titleFilterSupport: true in cypress-mcp.config.json if filtering is already configured.",
    );
    this.name = "TitleFilterUnavailableError";
  }
}
