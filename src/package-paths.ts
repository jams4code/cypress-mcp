// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";

// Files Cypress loads at run time ship next to dist/ in the package. This
// module sits one level under the package root both as src/ and once bundled
// into dist/index.js, so the same relative URLs resolve in tests and in use.

/** The Mocha reporter passed to `cypress run`. */
export const REPORTER_PATH = fileURLToPath(
  new URL("../reporter/cypress-mcp-reporter.cjs", import.meta.url),
);

/** runtime/config.cjs (wraps the project's config) and runtime/support.js (browser side). */
export const RUNTIME_DIR = fileURLToPath(new URL("../runtime/", import.meta.url));
