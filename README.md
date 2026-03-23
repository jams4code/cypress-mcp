# cypress-mcp

MCP server that gives AI coding agents full control over Cypress test execution.

Run, debug, and iterate on E2E tests directly from Claude Code, Cursor, Windsurf, or any MCP-compatible agent — without switching to a terminal.

## Why

AI agents can write Cypress tests but can't run them. Every change requires you to switch to terminal, run `npx cypress run`, wait, copy the output back. This kills iteration speed.

**cypress-mcp** closes the loop. The agent runs specs, reads failures, views screenshots, checks auth, and discovers the test suite — all within the conversation.

## Quick Start

```bash
npm install -g cypress-mcp
```

Register with Claude Code:

```bash
claude mcp add cypress-mcp -- npx cypress-mcp --cwd /path/to/project
```

Or add to your MCP config manually:

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp", "--cwd", "/path/to/your/project"]
    }
  }
}
```

## Tools

### Core

| Tool | What it does |
|------|-------------|
| `cypress_run_spec` | Run a spec file headless, get structured JSON results |
| `cypress_run_test` | Run a single test by name (grep filter) |
| `cypress_list_specs` | List all spec files with test counts |
| `cypress_get_config` | Show current configuration |

### Debug

| Tool | What it does |
|------|-------------|
| `cypress_get_screenshot` | Find failure screenshots by spec or test name |
| `cypress_get_last_run` | Get full results of the most recent run |
| `cypress_get_test_replay` | Get Cypress Cloud replay URL (if recording) |
| `cypress_clear_downloads` | Clear the downloads folder |

### Discovery

| Tool | What it does |
|------|-------------|
| `cypress_discover` | Map the entire test suite: specs, test names, counts |
| `cypress_analyze_spec` | Deep-parse a spec: describe blocks, visits, intercepts, fixtures |

### Auth & Environment

| Tool | What it does |
|------|-------------|
| `cypress_check_auth` | Check if auth tokens exist and are valid |
| `cypress_authenticate` | Run the project's auth command |
| `cypress_get_env` | Show cypress.env.json (secrets masked) |

### Project

| Tool | What it does |
|------|-------------|
| `cypress_validate_config` | Check config, deps, support file |
| `cypress_get_support_file` | Find and validate the support file |
| `cypress_install` | Install and verify Cypress |

## How It Works

```
AI Agent  ──stdio──▶  cypress-mcp  ──spawn──▶  Cypress
                      (JSON-RPC)                (headless)
                          │
                    Parse JSON output
                    Index screenshots
                    Return structured result
```

- **stdio transport** — the agent spawns the server as a child process
- **Serial execution** — one Cypress run at a time, no concurrency
- **Structured output** — JSON results with failure details, diffs, screenshot paths
- **Zero config** — auto-detects `cypress.config.ts`, specs, env files

## Configuration

Works out of the box for standard Cypress projects. For custom setups, create `cypress-mcp.config.json`:

```json
{
  "defaultBrowser": "chrome",
  "defaultTimeout": 600000,
  "screenshotsDir": "cypress/screenshots",
  "authCommand": "npm run authenticate",
  "authTokenPath": ".tmp/tokens.json"
}
```

## Supported Versions

- Cypress 12.x, 13.x, 14.x
- Node.js 18+
- Windows, macOS, Linux

## Development

```bash
git clone https://github.com/jams4code/cypress-mcp.git
cd cypress-mcp
npm install
npm run build
npm test
```

## License

[Business Source License 1.1](LICENSE) — free for individuals, education, and open source. Commercial production use requires a license. See [LICENSING.md](LICENSING.md) for details.

Converts to Apache 2.0 on March 25, 2029.
