# Changelog

## 0.2.0 (2026-10-19)

### License

- Relicensed from BUSL-1.1 to the **Apache License 2.0**. Free for any use, including commercial use and CI. Added `NOTICE`.

### Security

- Cypress is now started as `node <cypress>/bin/cypress` with no shell. Before, Windows runs used `shell: true` with unquoted arguments, so a crafted test name or spec path could run commands.
- Spec paths outside the project root are rejected by every tool that reads or runs a spec.
- Removed the `npx cypress` fallback, which could download and run an unpinned Cypress version when none was installed.
- Updated `@modelcontextprotocol/sdk` to 1.32 and refreshed the lockfile: `npm audit --omit=dev` reports 0 vulnerabilities (10 before).

### Cypress Cloud compatibility

- `cypress_run_spec` and `cypress_run_test` accept `record`, `tags`, `group` and `ciBuildId` to record runs to Cypress Cloud. The record key is read from `CYPRESS_RECORD_KEY` in the server environment and is never a tool argument.
- Recorded runs return `cloud: { runUrl, projectId, runNumber }`, which Cypress Cloud MCP tools accept directly. Failed recorded runs suggest `cypress_get_failed_tests` with that URL.
- `projectId` is read from the Cypress config, `CYPRESS_PROJECT_ID`, or `cypress-mcp.config.json`.
- New `cypress_get_config` tool reports the resolved config and Cloud readiness. `cypress_doctor` gained a Cypress Cloud check.
- Tool names are guaranteed not to collide with Cypress Cloud MCP tools (enforced by a test).

### Features

- Flaky test detection: every test reports `attempts` and `flaky` (failed, then passed on retry), and run stats include a `flaky` count.
- Cypress 16 support: env values and the grep filter are passed as JSON through `--env`, plus `--expose` on Cypress 15.10+ for `@cypress/grep` 7. Commas, quotes and string types are preserved.
- Cypress is resolved like any Node module, so hoisted installs in monorepos work.
- The server reports its real package version.

### Fixes

- The `cypress-mcp` bin entry is back in the package.
- `stats.skipped` was always 0.
- The JSON report is found even when the app or Cypress prints braces before it.
- Screenshots are looked up in the configured folder even when the config was created after the server started.
- A running Cypress process is killed when the MCP client disconnects.

### Breaking

- Node.js 22.12 or newer is required. Node 18 and 20 are end of life.
- Cypress must be installed in the project (or a parent workspace). There is no npx fallback.
- Unused `authCommand` and `authTokenPath` config fields were removed.

## 0.1.1 (2026-03-25)

- Standardized the response envelope (`ok`, `tool`, `summary`, `data`, `nextActions`) across tools and removed unused tools.
- Startup failures are reported separately from test failures, with clearer diagnostics.

## 0.1.0 (2026-03-24)

Initial release.

### Features

- **Core tools**: `cypress_run_spec`, `cypress_run_test`, `cypress_list_specs`, `cypress_get_config`
- **Debug tools**: `cypress_get_screenshot`, `cypress_get_last_run`, `cypress_get_test_replay`, `cypress_clear_downloads`
- **Auth tools**: `cypress_check_auth`, `cypress_authenticate`, `cypress_get_env`
- **Project tools**: `cypress_validate_config`, `cypress_get_support_file`, `cypress_install`
- **Discovery tools**: `cypress_discover`, `cypress_analyze_spec`
- Auto-detection of Cypress project configuration
- Serial execution with timeout safety
- Cross-platform support (Windows, macOS, Linux)
- Structured JSON output with failure details and screenshot paths
