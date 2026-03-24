---
name: cypress-testing
description: Guide for AI agents to efficiently discover, run, debug, and iterate on Cypress E2E tests via the cypress-mcp server. Covers the full write-run-inspect-fix-rerun loop.
metadata:
  priority: 8
  pathPatterns:
    - '*.cy.ts'
    - '*.cy.js'
    - '*.cy.tsx'
    - '*.cy.jsx'
    - 'cypress/**'
    - 'cypress.config.*'
  bashPatterns:
    - 'cypress'
    - 'cy\.'
  importPatterns: []
  promptSignals:
    phrases:
      - "cypress test"
      - "e2e test"
      - "run test"
      - "debug test"
      - "test failure"
    allOf: []
    anyOf: []
    noneOf: []
    minScore: 6
---

# Cypress Testing with cypress-mcp

## The Loop

The core workflow is: **discover → run → inspect → fix → rerun**

```
cypress_discover          → understand what exists
cypress_analyze_spec      → deep-dive into one spec
cypress_run_spec          → run it, get structured results
cypress_get_failure_context → understand WHY it failed
  (fix the code)
cypress_rerun_last        → verify the fix, zero friction
```

## When to Use Each Tool

### 1. Starting a Session

Always begin with `cypress_doctor` to verify the project is healthy, then `cypress_discover` to map the test suite.

### 2. Writing New Tests

1. `cypress_discover` — see existing test coverage
2. `cypress_analyze_spec` — understand patterns in similar specs
3. Write the test
4. `cypress_run_spec` — run it immediately
5. `cypress_get_failure_context` — if it fails, get the full context
6. Fix and `cypress_rerun_last`

### 3. Debugging a Failure

1. `cypress_run_spec` or `cypress_run_test` — reproduce the failure
2. `cypress_get_failure_context` — get error, stack hint, spec excerpt, screenshots
3. `cypress_get_screenshot` — view the failure screenshot (multimodal agents)
4. Fix the code based on the context
5. `cypress_rerun_last` — verify without reconstructing args

### 4. Iterating on a Fix

Just use `cypress_rerun_last` repeatedly after each code change. It replays the exact same command. No need to remember the spec path or test name.

## Tool Reference (11 tools)

### Discovery
| Tool | When to Use |
|------|------------|
| `cypress_discover` | First thing. Maps all specs, test names, counts. |
| `cypress_analyze_spec` | Deep-dive into one spec: describes, visits, intercepts, fixtures, custom commands. |
| `cypress_list_specs` | Quick list of spec file paths with test counts. |

### Execution
| Tool | When to Use |
|------|------------|
| `cypress_run_spec` | Run an entire spec file. Returns structured results with nextActions. |
| `cypress_run_test` | Run one specific test by name (grep filter). |
| `cypress_rerun_last` | Replay the exact last run. Use after fixing code. |

### Inspection
| Tool | When to Use |
|------|------------|
| `cypress_get_failure_context` | The key debugging tool. Returns error, stack hint, spec excerpt, screenshots, and suggested next actions in one call. |
| `cypress_get_last_run` | Full structured results of the most recent run. |
| `cypress_get_screenshot` | Find failure screenshots by spec or test name. |

### Setup
| Tool | When to Use |
|------|------------|
| `cypress_get_env` | View cypress.env.json with secrets masked. |
| `cypress_doctor` | Health check: config, binary, specs, support file. |

## Response Format

All tools return a consistent envelope:

```json
{
  "ok": true,
  "tool": "cypress_run_spec",
  "runId": "run_1",
  "summary": "1 failing test in login.cy.ts",
  "data": { ... },
  "nextActions": ["cypress_get_failure_context"]
}
```

Always check `ok` and follow `nextActions` for the recommended next step.

## Best Practices

- **One spec per feature area** — login.cy.ts, dashboard.cy.ts, etc.
- **Use data-cy selectors** — `cy.get('[data-cy="submit"]')` not `cy.get('.btn-primary')`
- **Name tests clearly** — `"should show error when password is invalid"` not `"test 2"`
- **Run before committing** — always verify tests pass via `cypress_run_spec`
- **Use discovery first** — don't guess what tests exist, ask `cypress_discover`
