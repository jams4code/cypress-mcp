// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * All logging goes to stderr to keep stdout clean for MCP transport. `quiet`
 * drops info lines: the CLI's stderr usually reaches the agent too, and only
 * warnings and errors are worth its tokens there.
 */
export function createLogger(verbose = false, quiet = false): Logger {
  const write = (
    level: string,
    message: string,
    data?: Record<string, unknown>,
  ): void => {
    const entry = data
      ? `[cypress-mcp] ${level}: ${message} ${JSON.stringify(data)}`
      : `[cypress-mcp] ${level}: ${message}`;
    process.stderr.write(entry + "\n");
  };

  return {
    info: (msg, data) => {
      if (verbose || !quiet) write("INFO", msg, data);
    },
    warn: (msg, data) => write("WARN", msg, data),
    error: (msg, data) => write("ERROR", msg, data),
    debug: (msg, data) => {
      if (verbose) write("DEBUG", msg, data);
    },
  };
}
