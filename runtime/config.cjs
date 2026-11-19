// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
//
// Loaded by Cypress, in its config process, through the wrapper config file
// cypress-mcp writes for each run in node_modules/.cache/cypress-mcp/runs/.
// The wrapper imports the project's own cypress.config.* and passes it here;
// nothing in the project is changed.
//
// wrapConfig returns the project's config with:
// - the cypress-mcp reporter, with the project's reporter kept as an inner
//   reporter that receives every event (junit, mochawesome, ...);
// - a support file per testing type that imports the project's support file,
//   then the cypress-mcp browser runtime (failure context, title filter);
// - setupNodeEvents chained: the cypress-mcp task is registered, then the
//   project's own setupNodeEvents runs as before.
//
// CommonJS with no dependencies: the wrapper loads it with import or require
// depending on the project's module type, and Cypress runs the config with
// the project's Node.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Task the browser runtime calls with the context of a failed test. */
const CONTEXT_TASK = "cypressMcp:failureContext";

/** Cypress's default reporter: nothing worth keeping next to ours. */
const DEFAULT_REPORTER = "spec";

const SUPPORT_EXTENSIONS = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];

/**
 * @param {object} userConfig the project's config, as its file exports it
 * @param {{ projectRoot: string, runDir: string, reporterPath: string,
 *   contextFile: string, supportRuntime: string }} options
 */
function wrapConfig(userConfig, options) {
  if (!userConfig || typeof userConfig !== "object") {
    return userConfig;
  }

  const config = { ...userConfig };
  config.reporter = options.reporterPath;
  config.reporterOptions = {
    cypressMcpInner: innerReporter(
      userConfig.reporter,
      userConfig.reporterOptions,
      options,
    ),
  };

  for (const testingType of ["e2e", "component"]) {
    const original = userConfig[testingType];
    if (!original || typeof original !== "object") {
      continue;
    }

    const wrapped = { ...original };
    const supportFile = writeSupportFile(testingType, original.supportFile, options);
    if (supportFile) {
      wrapped.supportFile = supportFile;
    }

    const userSetup = original.setupNodeEvents;
    wrapped.setupNodeEvents = async (on, cypressConfig) => {
      on("task", {
        [CONTEXT_TASK]: (payload) => {
          appendContext(options.contextFile, payload);
          return null;
        },
      });

      const result =
        typeof userSetup === "function" ? await userSetup(on, cypressConfig) : undefined;

      // Plugins may set the reporter here (cypress-multi-reporters setups do).
      // Keep theirs as the inner reporter instead of losing ours.
      if (
        result &&
        typeof result === "object" &&
        typeof result.reporter === "string" &&
        result.reporter !== options.reporterPath
      ) {
        return {
          ...result,
          reporter: options.reporterPath,
          reporterOptions: {
            cypressMcpInner: innerReporter(
              result.reporter,
              result.reporterOptions,
              options,
            ),
          },
        };
      }
      return result;
    };

    config[testingType] = wrapped;
  }

  return config;
}

/** The project's reporter, for the cypress-mcp reporter to run alongside. */
function innerReporter(name, reporterOptions, options) {
  if (typeof name !== "string" || name === "" || name === DEFAULT_REPORTER) {
    return null;
  }
  if (path.resolve(options.projectRoot, name) === options.reporterPath) {
    return null;
  }
  return {
    name,
    options:
      reporterOptions && typeof reporterOptions === "object" ? reporterOptions : {},
    projectRoot: options.projectRoot,
  };
}

/**
 * Writes the support file used for one testing type: the project's support
 * file (when it has one), then the cypress-mcp runtime. Returns its path, or
 * undefined to leave the project's setting untouched.
 */
function writeSupportFile(testingType, configured, options) {
  let userSupport;
  if (configured === false) {
    userSupport = null;
  } else if (typeof configured === "string") {
    userSupport = findFirst(expandBraces(configured), options.projectRoot);
    if (userSupport === undefined && /[*?[\]]/.test(configured)) {
      // A glob this file cannot expand: keep the project's own setting.
      return undefined;
    }
  } else {
    userSupport = findFirst(
      SUPPORT_EXTENSIONS.map((ext) => `cypress/support/${testingType}.${ext}`),
      options.projectRoot,
    );
  }

  const lines = [];
  if (userSupport) {
    lines.push(`import ${JSON.stringify(importPath(options.runDir, userSupport))};`);
  }
  lines.push(
    `import ${JSON.stringify(importPath(options.runDir, options.supportRuntime))};`,
  );

  // .mjs: bundlers treat it as an ES module whatever the project's
  // package.json "type" says.
  const file = path.join(options.runDir, `support.${testingType}.mjs`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

/** `{a,b}` groups expanded, the way Cypress's default supportFile uses them. */
function expandBraces(pattern) {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) {
    return [pattern];
  }
  return match[1]
    .split(",")
    .flatMap((option) =>
      expandBraces(
        pattern.slice(0, match.index) +
          option +
          pattern.slice(match.index + match[0].length),
      ),
    );
}

function findFirst(candidates, projectRoot) {
  for (const candidate of candidates) {
    const absolute = path.resolve(projectRoot, candidate);
    try {
      if (fs.statSync(absolute).isFile()) {
        return absolute;
      }
    } catch {
      // Not there; try the next one.
    }
  }
  return undefined;
}

/** A relative import specifier with forward slashes, from `fromDir` to `file`. */
function importPath(fromDir, file) {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function appendContext(file, payload) {
  try {
    fs.appendFileSync(file, `${JSON.stringify(payload)}\n`);
  } catch {
    // Context is a bonus; a full disk must not fail the user's test.
  }
}

module.exports = { wrapConfig, CONTEXT_TASK, expandBraces };
