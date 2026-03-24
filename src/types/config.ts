// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
export interface CypressMcpConfig {
  readonly projectRoot: string;
  readonly cypressConfigFile: string;
  readonly defaultBrowser: string;
  readonly defaultTimeout: number;
  readonly screenshotsDir: string;
  readonly downloadsDir: string;
  readonly specPattern: string;
  readonly authCommand?: string;
  readonly authTokenPath?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RawServerConfig {
  cypressConfigFile?: string;
  defaultBrowser?: string;
  defaultTimeout?: number;
  screenshotsDir?: string;
  downloadsDir?: string;
  authCommand?: string;
  authTokenPath?: string;
}

export const DEFAULT_CONFIG: Omit<CypressMcpConfig, "projectRoot" | "cypressConfigFile"> =
  {
    defaultBrowser: "electron",
    defaultTimeout: 300_000,
    screenshotsDir: "cypress/screenshots",
    downloadsDir: "cypress/downloads",
    specPattern: "cypress/e2e/**/*.cy.{ts,js,tsx,jsx}",
  };

export const CYPRESS_CONFIG_FILES = [
  "cypress.config.ts",
  "cypress.config.js",
  "cypress.config.mjs",
  "cypress.config.cjs",
] as const;

export const SERVER_CONFIG_FILE = "cypress-mcp.config.json";
