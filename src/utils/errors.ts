// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
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
      "Run 'npm install cypress' or 'npx cypress install' in your project.",
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

export class ProcessBusyError extends CypressMcpError {
  constructor() {
    super(
      "A Cypress process is already running",
      "PROCESS_BUSY",
      "Wait for the current run to finish, or use a longer timeout.",
    );
    this.name = "ProcessBusyError";
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
