# Cypress MCP Server

**An MCP (Model Context Protocol) server that gives AI coding agents full control over Cypress test execution.**

Run, debug, and iterate on Cypress E2E tests directly from Claude Code, Cursor, Windsurf, or any MCP-compatible AI agent — without switching to a terminal.

---

## The Problem

AI coding agents can write Cypress tests but cannot run them. Every change requires the developer to:

1. Switch to terminal
2. Run `npx cypress run --spec X`
3. Wait 1-5 minutes
4. Copy the output back to the AI
5. Repeat

For CI/CD pipelines, the feedback loop is even worse: push, wait 15-20 minutes, read logs, fix, push again.

**This kills the iteration speed that makes AI-assisted development valuable.**

## The Solution

A local MCP server that wraps Cypress with structured, AI-friendly tools. The AI agent can:

- Run any spec file and get structured JSON results
- Read failure details with diffs and error messages
- View screenshots of failures (returned as file paths for multimodal LLMs)
- Check and refresh authentication
- Manage test state (clear downloads, reset data)
- Run specific tests by name within a spec

All without the developer leaving their AI agent conversation.

---

## Features

### Core Tools

| Tool | Description |
|------|-------------|
| `cypress_run_spec` | Run a single spec file headless. Returns structured results: pass/fail counts, failure details with error messages and diffs, screenshot paths, duration. |
| `cypress_run_test` | Run a specific test by name within a spec (using `--grep`). Useful for focused debugging. |
| `cypress_list_specs` | List all available spec files in the project. |
| `cypress_get_config` | Return the current Cypress configuration (baseUrl, browser, timeouts, env vars). |

### Debugging Tools

| Tool | Description |
|------|-------------|
| `cypress_get_screenshot` | Return the file path of the latest failure screenshot for a given spec. The AI agent can then read the image file directly. |
| `cypress_get_test_replay` | Return the Cypress Cloud replay URL for the last run (if recording is enabled). |
| `cypress_get_last_run` | Return the full JSON results of the most recent test run. |
| `cypress_clear_downloads` | Clear the `cypress/downloads/` folder (useful before re-running export tests). |

### Auth & Environment Tools

| Tool | Description |
|------|-------------|
| `cypress_check_auth` | Verify authentication tokens exist and are not expired. Returns token status and expiry time. |
| `cypress_authenticate` | Run the project's authentication flow (e.g., MSAL token acquisition). Requires the target URL as input. |
| `cypress_get_env` | Return the current `cypress.env.json` contents (with secrets masked). |

### Project Management Tools

| Tool | Description |
|------|-------------|
| `cypress_get_support_file` | Return the support file path and check it compiles without errors. |
| `cypress_validate_config` | Validate the Cypress configuration file (check for import errors, missing dependencies). |
| `cypress_install` | Run Cypress installation and dependency check (`cypress verify`). |

---

## Architecture

```
┌─────────────────────────┐
│   AI Agent (Claude Code) │
│   or any MCP client      │
└───────────┬─────────────┘
            │ stdio (JSON-RPC)
┌───────────▼─────────────┐
│   cypress-mcp server     │
│   Node.js + MCP SDK      │
├──────────────────────────┤
│   Tool Router            │
│   ├── run-spec           │
│   ├── run-test           │
│   ├── list-specs         │
│   ├── get-screenshot     │
│   ├── check-auth         │
│   └── ...                │
├──────────────────────────┤
│   Cypress Process Mgr    │
│   ├── Spawn headless     │
│   ├── JSON reporter      │
│   ├── Timeout handling   │
│   └── Output parser      │
└───────────┬─────────────┘
            │ child_process
┌───────────▼─────────────┐
│   Cypress Runtime        │
│   ├── Electron browser   │
│   ├── Test specs         │
│   ├── Screenshots        │
│   └── Downloads          │
└──────────────────────────┘
```

### Transport

**stdio** (standard input/output) — the simplest and most portable MCP transport. The AI agent spawns the server as a child process and communicates via JSON-RPC over stdin/stdout.

### Process Management

- Each `run_spec` / `run_test` call spawns a new Cypress process
- Only one Cypress process runs at a time (serial execution, no concurrency)
- Configurable timeout per run (default: 5 minutes)
- Process is killed on timeout with clear error message
- Screenshots and artifacts are preserved between runs

### Output Parsing

Cypress `--reporter json` produces structured output. The server parses this into a clean response:

```json
{
  "success": false,
  "stats": {
    "tests": 1,
    "passing": 0,
    "failing": 1,
    "pending": 0,
    "duration": 42000
  },
  "failures": [
    {
      "title": "should send the recipe to equipment",
      "fullTitle": "QCS e2e test > should send the recipe to equipment",
      "error": "CypressError: cy.click() can only be called on a single element. Your subject contained 2 elements.",
      "stack": "at mouseAction (cypress_runner.js:112650:68)\n...",
      "screenshot": "cypress/screenshots/send-job-to-machine.cy.ts/QCS e2e test -- should send (failed).png"
    }
  ],
  "screenshots": [
    "cypress/screenshots/send-job-to-machine.cy.ts/QCS e2e test -- should send (failed).png"
  ]
}
```

---

## Configuration

### Auto-Detection

The server auto-detects the Cypress project by looking for:
1. `cypress.config.ts` or `cypress.config.js` in the current working directory
2. `cypress/` folder (spec files, support, plugins)
3. `cypress.env.json` (environment configuration)
4. `package.json` with Cypress dependency

### Server Config (`cypress-mcp.config.json`, optional)

```json
{
  "cypressConfigFile": "cypress.config.ts",
  "defaultBrowser": "electron",
  "defaultTimeout": 300000,
  "screenshotsDir": "cypress/screenshots",
  "downloadsDir": "cypress/downloads",
  "authCommand": "npm run authenticate",
  "authTokenPath": ".tmp/tokens.json"
}
```

If no config file exists, the server uses sensible defaults based on the detected Cypress project.

---

## Installation & Usage

### As a global tool

```bash
npm install -g cypress-mcp
```

### In a project

```bash
npm install --save-dev cypress-mcp
```

### Register with Claude Code

```bash
claude mcp add cypress-mcp -- npx cypress-mcp --cwd /path/to/project
```

Or manually in settings:

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp"],
      "cwd": "/path/to/your/cypress/project"
    }
  }
}
```

### Register with Cursor / VS Code

Add to `.cursor/mcp.json` or VS Code MCP settings:

```json
{
  "cypress": {
    "command": "npx",
    "args": ["cypress-mcp"],
    "cwd": "${workspaceFolder}"
  }
}
```

---

## Supported Cypress Versions

- Cypress 12.x, 13.x, 14.x
- Node.js 18+
- TypeScript and JavaScript configs
- All browsers supported by Cypress (Electron, Chrome, Firefox, Edge)

---

## Key Design Principles

1. **Zero configuration for standard projects.** If you have a `cypress.config.ts` and specs, it works.
2. **Structured output over raw logs.** AI agents need JSON, not ANSI terminal art.
3. **Screenshots are first-class.** Return file paths so multimodal agents can see what failed.
4. **Serial execution.** One test at a time. No concurrency complexity.
5. **Respect the existing project.** No modifications to `cypress.config.ts`, no injected plugins, no monkey-patching. The server is a wrapper, not a framework.
6. **Timeout safety.** Every Cypress run has a hard timeout. Stuck tests don't hang the agent.

---

## Non-Goals

- Not a test runner replacement (use `npx cypress run` for CI/CD)
- Not a Cypress Cloud alternative (no dashboard, no parallelization)
- Not a browser automation tool (use Playwright MCP for general browsing)
- Not a test generator (the AI agent writes tests, this server runs them)

---

## Comparison

| Feature | Raw Bash | cypress-mcp |
|---------|----------|-------------|
| Structured results | No (parse terminal) | Yes (JSON) |
| Failure diffs | Buried in output | Extracted per test |
| Screenshots | Saved to disk, manual | File paths returned |
| Auth management | Manual commands | Built-in check/refresh |
| Timeout handling | Bash 2min default | 5min configurable |
| Project validation | None | Config + dependency check |
| AI agent integration | Copy-paste | Native MCP tools |

---

## Roadmap

### v1.0 — Core
- Run specs, get structured results
- Screenshot access
- Auth check/refresh
- Project auto-detection

### v1.1 — Enhanced Debugging
- Cypress Cloud integration (replay URLs)
- DOM snapshot on failure (serialized HTML)
- Network request log (intercepted API calls)
- Console log capture

### v1.2 — Interactive Mode
- Watch mode (re-run on file change)
- Selective test re-run (only failed tests)
- Component testing support

### v2.0 — Multi-Project
- Support multiple Cypress projects simultaneously
- Cross-project test orchestration
- Shared authentication across projects
