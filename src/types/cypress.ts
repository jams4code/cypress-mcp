// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
/** Raw Mocha JSON reporter output from Cypress */
export interface MochaJsonReport {
  readonly stats: MochaStats;
  readonly tests: readonly MochaTest[];
  readonly pending: readonly MochaTest[];
  readonly failures: readonly MochaTest[];
  readonly passes: readonly MochaTest[];
}

export interface MochaStats {
  readonly suites: number;
  readonly tests: number;
  readonly passes: number;
  readonly pending: number;
  readonly failures: number;
  readonly start: string;
  readonly end: string;
  readonly duration: number;
}

export interface MochaTest {
  readonly title: string;
  readonly fullTitle: string;
  readonly duration: number;
  readonly currentRetry: number;
  readonly speed?: "slow" | "medium" | "fast";
  readonly err: MochaError;
}

export interface MochaError {
  readonly message?: string;
  readonly stack?: string;
  readonly actual?: string;
  readonly expected?: string;
  readonly showDiff?: boolean;
}

/** Arguments for spawning a Cypress run */
export interface CypressRunArgs {
  readonly spec: string;
  readonly browser?: string;
  readonly headed?: boolean;
  readonly timeout?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly grep?: string;
}
