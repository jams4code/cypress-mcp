# cypress-mcp

An open source (Apache-2.0) MCP server that lets AI coding agents run and debug Cypress tests on the developer's machine.

## The problem

Agents write Cypress tests but cannot see them run. Without a runner they guess, or the developer copies terminal output back and forth: run `npx cypress run --spec X`, wait, paste, repeat. Raw Cypress output is also a poor input for an agent: ANSI tables, long stacks from inside the Cypress binary, screenshots on disk with no link to the failure.

## What it does

The agent calls tools; cypress-mcp starts Cypress with the project's own config, waits for the result and returns a short text the agent can act on: per failure the file and line, the error, the screenshot and the page when it failed (fenced as untrusted app data), then the full data in `structuredContent`. Agents with a shell can run the same thing as a CLI.

| Area | Tools |
|------|-------|
| Default | `cypress_run` (specs, `path:line`, globs; `testName`, `repeat`, `component`, `project`), `cypress_get_failure` (a run's failures, page, tests, screenshots or output, by `runId`), `cypress_list_specs`, `cypress_doctor` |
| `--caps analyze` | `cypress_analyze_spec` |
| `--caps config` | `cypress_get_config`, `cypress_get_env` |
| `--caps legacy` | The 0.2 names, until 0.5 |

Runs report progress per test to clients that ask for it, stop when the client cancels the request, and keep their partial results when they hit the timeout. Runs can be recorded to Cypress Cloud (`record: true`); the result carries the Cloud run URL that Cypress Cloud MCP tools accept. No tool name overlaps with Cypress Cloud MCP, so agents can load both.

## How it works

- **Transport**: stdio, MCP TypeScript SDK v2, for 2025 and 2026-07-28 clients. The client starts `cypress-mcp --cwd <project>` as a child process; `npx` installs one package because the dependencies are bundled.
- **Runs**: `node <project>/node_modules/cypress/bin/cypress run --spec ... --config-file <wrapper>`. No shell on any platform, every argument passed verbatim. One run at a time; later calls queue. Each run has its own folder in `node_modules/.cache/cypress-mcp/runs/` for its wrapper config, reports, screenshots and failure context.
- **Wrapper config**: imports the project's config unchanged, chains its `setupNodeEvents`, adds a support file that imports the project's and then `runtime/support.js`, which records the page at each failure and filters titles. Falls back to the plain config when the project's does not load through it.
- **Results**: a small Mocha reporter shipped in the package (`reporter/cypress-mcp-reporter.cjs`) writes each spec's report to the run folder and one event line per test to stdout for progress and timeouts; the project's own reporter runs on the same events.
- **Config**: read from `cypress.config.*` (and its relative imports) and an optional `cypress-mcp.config.json`, and reloaded when any of those files change.
- **Boundaries**: spec paths must stay inside the project root; `browser` must be a name `cypress info` lists; `cypress_get_env` returns keys and types only; the Cypress Cloud record key is read from the server environment and never passes through the agent.

## Principles

1. **Zero config for standard projects.** A `cypress.config.*` and specs are enough.
2. **Few tokens, all the data.** The agent reads the cause, the place and the next call in a few lines; the complete result is in `structuredContent` for code that wants it.
3. **Respect the project.** Its config, browser choice, support file and reporter are used as they are. Nothing is written outside `node_modules/.cache/cypress-mcp`.
4. **Safe by default.** No shell, no paths outside the project, no secrets in tool results, no npx fallback that downloads an unpinned Cypress.
5. **Every run ends.** A hard timeout, client cancellation and client disconnect all stop the whole Cypress process tree.

## Supported

- Cypress 14 to 16. CI runs the end-to-end suite on Cypress 14 and the latest release.
- Node.js 22.12 or newer.
- Windows, macOS and Linux.
- Any MCP client that runs local stdio servers. See the README for per-client setup.

## Not in scope

- Replacing `cypress run` in CI or Cypress Cloud (dashboards, parallelization).
- General browser automation (use a browser MCP server).
- Writing tests. The agent writes them; this server runs them.

## Roadmap

- **0.3.0, agent first.** Compact results with `structuredContent` and `outputSchema`, `runId` everywhere, server instructions, titles and annotations, four default tools, a bundled package, the CLI.
- **0.4.0, failure context.** The page at each failure (DOM/ARIA outline, URL, console and network errors, command log, similar selectors) through a wrapper config in `node_modules/.cache`; the project's reporters kept; several specs per launch, `path:line`, `repeat`, component tests, monorepos; a screenshots folder per run; screenshots as resource links.
- **Next.** Test Replay style step history, network bodies for failed requests, an MCPB bundle for Claude Desktop.

## License

Apache License 2.0. Copyright (c) 2026 JADEV GROUP SARL. See LICENSE and NOTICE.
