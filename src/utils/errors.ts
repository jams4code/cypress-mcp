// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
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

export class TimeoutError extends CypressMcpError {
  constructor(timeout: number) {
    super(
      `Cypress process timed out after ${timeout}ms`,
      "TIMEOUT",
      "Increase the timeout or check if the test is stuck.",
    );
    this.name = "TimeoutError";
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

export class TitleFilterUnavailableError extends CypressMcpError {
  constructor() {
    super(
      "cypress_run_test requires grep-based title filtering to be configured in the Cypress project.",
      "TITLE_FILTER_UNAVAILABLE",
      "Wire @cypress/grep (or an equivalent grep plugin) into the project, or set titleFilterSupport: true in cypress-mcp.config.json if filtering is already configured.",
    );
    this.name = "TitleFilterUnavailableError";
  }
}
