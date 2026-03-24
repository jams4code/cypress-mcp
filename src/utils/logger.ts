// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * All logging goes to stderr to keep stdout clean for MCP transport.
 */
export function createLogger(verbose = false): Logger {
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
    info: (msg, data) => write("INFO", msg, data),
    warn: (msg, data) => write("WARN", msg, data),
    error: (msg, data) => write("ERROR", msg, data),
    debug: (msg, data) => {
      if (verbose) write("DEBUG", msg, data);
    },
  };
}
