---
name: cypress-testing
description: Complete guide for AI agents to do frontend E2E testing SDLC with cypress-mcp — discover, write, run, debug, iterate, and regression test Cypress specs without leaving the conversation.
metadata:
  priority: 9
  pathPatterns:
    - '*.cy.ts'
    - '*.cy.js'
    - '*.cy.tsx'
    - '*.cy.jsx'
    - 'cypress/**'
    - 'cypress.config.*'
    - 'cypress-mcp.config.json'
  bashPatterns:
    - 'cypress'
    - 'cy\.'
    - 'cypress-mcp'
  importPatterns: []
  promptSignals:
    phrases:
      - "cypress test"
      - "e2e test"
      - "run test"
      - "debug test"
      - "test failure"
      - "write test"
      - "test this feature"
      - "run the tests"
      - "why is this test failing"
      - "screenshot"
    allOf: []
    anyOf: []
    noneOf: []
    minScore: 5
---

# Frontend E2E Testing SDLC with cypress-mcp

## Core Principle

The product is the **discover → write → run → inspect → fix → rerun** loop. Every tool exists to make one step of that loop faster. `cypress_run_spec` is the source of truth — if the test passes, the feature works.

## Quick Reference

| When | Tool |
|------|------|
| Starting work | `cypress_doctor` → `cypress_discover` |
| Understanding a spec | `cypress_analyze_spec` |
| Listing specs | `cypress_list_specs` |
| Running tests | `cypress_run_spec` or `cypress_run_test` |
| Test failed | `cypress_get_failure_context` (one call = everything you need) |
| See failure visually | `cypress_get_screenshot` (read the image file directly) |
| After fixing code | `cypress_rerun_last` (replays exact last command) |
| Check full results | `cypress_get_last_run` |
| Check env config | `cypress_get_env` |

## Phase 1: Start Every Session

```
cypress_doctor         → is the project healthy?
cypress_discover       → what tests exist? what's the coverage?
```

Never skip discovery. Never guess what tests exist. The AI must understand the test landscape before writing or running anything.

## Phase 2: Write Tests

### Before writing
1. `cypress_discover` — see existing coverage, find gaps
2. `cypress_analyze_spec` — study a similar spec to understand the project's conventions (page objects, selectors, helpers, hooks)
3. Follow the existing patterns — don't invent new patterns unless the project has none

### Writing conventions
- **One spec per feature area** — `login.cy.ts`, `checkout.cy.ts`, `dashboard.cy.ts`
- **Use data attributes for selectors** — `cy.get('[data-cy="submit"]')` or `cy.get('[data-test="submit"]')`, never CSS classes
- **Name tests clearly** — `"should show error when password is invalid"`, not `"test 2"`
- **Describe blocks match feature areas** — `describe("Login Page", () => { ... })`
- **Use beforeEach for common setup** — navigation, auth, test data
- **Keep tests independent** — each test should work in isolation

### Test structure
```typescript
describe("Feature Name", () => {
  beforeEach(() => {
    cy.visit("/feature-page");
    // setup: auth, test data, intercepts
  });

  it("should do the happy path", () => {
    // action + assertion
  });

  it("should handle the error case", () => {
    // intercept API to return error
    // verify error UI
  });
});
```

## Phase 3: Run and Debug

### The debug loop
```
cypress_run_spec              → run the spec
  ↓ fails?
cypress_get_failure_context   → get error + stack + spec excerpt + screenshots
  ↓ read screenshot if needed
cypress_get_screenshot        → view what the browser actually showed
  ↓ fix the code
cypress_rerun_last            → verify fix (zero friction, replays exact args)
  ↓ still failing? → back to get_failure_context
  ↓ passing? → done
```

### Key behaviors
- **`cypress_get_failure_context`** is the most important debugging tool. One call returns: failing test title, error message, stack hint pointing to user code, spec excerpt around the failure, screenshot paths, and recommended next actions. Always use this instead of manually parsing run results.
- **`cypress_rerun_last`** replays the exact previous `run_spec` or `run_test` invocation from state. Use it after every fix attempt — no need to remember spec paths or test names.
- **`cypress_get_screenshot`** returns absolute file paths. Multimodal agents should read the image file directly to see what the browser rendered at failure time.

### When Cypress can't start
If `cypress_run_spec` returns `"Cypress failed to start"`:
1. Run `cypress_doctor` to diagnose
2. Common causes: missing config file, Node version mismatch, missing dependencies, config import errors
3. The error message includes the actual Cypress output (DevTools noise is filtered)

## Phase 4: Full Feature SDLC

When implementing a new frontend feature end-to-end:

1. **Discover** — `cypress_discover` to see current test coverage
2. **Analyze** — `cypress_analyze_spec` on related specs to learn conventions
3. **Write the feature code** — implement the UI change
4. **Write the E2E test** — create a spec that validates the feature
5. **Run** — `cypress_run_spec` against the new spec
6. **Debug** — if failing: `cypress_get_failure_context` → fix → `cypress_rerun_last`
7. **Regression** — run related/adjacent specs to ensure nothing broke
8. **Commit** — only after all tests pass

**Rule: if the test passes, the feature works. If it fails, fix the code, not the test** (unless the test itself has a bug).

## Phase 5: Regression Testing

After any code change that touches shared components, run the full suite:
```
cypress_list_specs           → get all specs
cypress_run_spec spec=...    → run each relevant spec
```

Or run the specific spec that covers the changed area:
```
cypress_discover             → find which spec covers the changed feature
cypress_run_spec             → run just that spec
```

## Response Envelope

All tools return a consistent format:
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

- **Always check `ok`** — `false` means the tool itself had an error (not just test failures)
- **Always follow `nextActions`** — the server recommends the optimal next step
- **`runId`** tracks state across tool calls — `cypress_rerun_last` and `cypress_get_failure_context` reference the last run

## Rules

1. **Never guess why a test fails** — always call `cypress_get_failure_context`
2. **Never copy terminal output manually** — the MCP tools return structured JSON
3. **Never skip discovery** before writing new tests
4. **Never commit tests that haven't passed** through `cypress_run_spec`
5. **Never hardcode waits** — use Cypress's built-in retry/assertion mechanism
6. **Never use CSS selectors** — use `data-cy`, `data-test`, or `data-testid` attributes
7. **Fix the code, not the test** — unless the test itself is wrong

## Common Patterns

### Login flow
```typescript
cy.visit("/login");
cy.get('[data-cy="email"]').type("user@example.com");
cy.get('[data-cy="password"]').type("password123");
cy.get('[data-cy="submit"]').click();
cy.url().should("include", "/dashboard");
```

### API intercept
```typescript
cy.intercept("GET", "/api/users", { fixture: "users.json" }).as("getUsers");
cy.visit("/users");
cy.wait("@getUsers");
cy.get('[data-cy="user-list"]').should("have.length.gt", 0);
```

### Form validation
```typescript
cy.get('[data-cy="submit"]').click();
cy.get('[data-cy="email-error"]').should("contain", "Email is required");
```

### File upload
```typescript
cy.get('[data-cy="file-input"]').selectFile("cypress/fixtures/document.pdf");
cy.get('[data-cy="upload-success"]').should("be.visible");
```
