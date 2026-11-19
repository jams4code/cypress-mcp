// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
export interface CypressMcpConfig {
  readonly projectRoot: string;
  readonly cypressConfigFile: string;
  /**
   * Browser passed to every run, from cypress-mcp.config.json only. When unset
   * no --browser flag is sent, so Cypress uses the project's own choice.
   */
  readonly defaultBrowser?: string;
  readonly defaultTimeout: number;
  readonly screenshotsDir: string;
  readonly downloadsDir: string;
  readonly specPattern: readonly string[];
  readonly supportFile?: string | false;
  readonly titleFilterSupport: boolean;
  /** Cypress Cloud project id, needed to record runs and to query Cloud MCP */
  readonly projectId?: string;
  /**
   * Run through the wrapper config that records the page at each failure and
   * filters titles without @cypress/grep. Default true.
   */
  readonly failureContext: boolean;
}

export interface RawServerConfig {
  failureContext?: boolean;
  cypressConfigFile?: string;
  defaultBrowser?: string;
  defaultTimeout?: number;
  screenshotsDir?: string;
  downloadsDir?: string;
  specPattern?: string | readonly string[];
  supportFile?: string | false;
  titleFilterSupport?: boolean;
  projectId?: string;
}

export const DEFAULT_CONFIG: Omit<CypressMcpConfig, "projectRoot" | "cypressConfigFile"> =
  {
    defaultTimeout: 300_000,
    screenshotsDir: "cypress/screenshots",
    downloadsDir: "cypress/downloads",
    specPattern: ["cypress/e2e/**/*.cy.{ts,js,tsx,jsx}"],
    titleFilterSupport: false,
    failureContext: true,
  };

export const CYPRESS_CONFIG_FILES = [
  "cypress.config.ts",
  "cypress.config.js",
  "cypress.config.mjs",
  "cypress.config.cjs",
  "cypress.config.mts",
  "cypress.config.cts",
] as const;

export const SERVER_CONFIG_FILE = "cypress-mcp.config.json";
