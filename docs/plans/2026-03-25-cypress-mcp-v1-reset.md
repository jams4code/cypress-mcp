# Plan: Cypress MCP v1 Reset

This replaces the earlier greenfield plan with a v1 scope that matches the current repository state and the real goal: a tight AI-agent feedback loop for Cypress authoring and debugging. The current repo already has partial implementation, but it is not yet coherent or shippable.

## Current State

- In repo:
  - Core server, service, and tool scaffolding exists under `src/`
  - Unit-test fixtures and a handful of unit tests exist under `test/`
  - Discovery types exist
- Broken or incomplete:
  - `src/tools/index.ts` imports `src/tools/discovery/discover.ts`, but that file does not exist
  - `package.json` references `README.md`, but `README.md` is missing
  - `.eslintrc.cjs` depends on `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`, but those packages are not declared
  - Integration tests, CI, licensing docs, and packaging verification are mostly absent
  - Several tool descriptions promise behavior the code does not implement

## Challenge The Original Plan

### What is too much for v1

- Generic auth automation:
  - `cypress_authenticate`
  - `cypress_check_auth`
  These are highly project-specific and create portability problems early.
- Cypress Cloud replay support:
  - `cypress_get_test_replay`
  This is not a reliable local primitive unless run metadata and Cloud recording are wired end to end.
- Low-value project introspection as standalone tools:
  - `cypress_get_support_file`
  This is useful as a validation detail, not as a first-class workflow tool.
- Skill creation in the main implementation path:
  - useful for adoption, but not part of the server MVP

### What is missing from the original plan

- A true failure-context tool for agent debugging
- A rerun primitive so the agent can repeat the exact last command without reconstructing arguments
- Stable run IDs in state so follow-up tools can refer to a specific run
- A consistent response envelope across tools
- A monorepo-friendly way to point the server at the actual Cypress project root
- Explicit alignment between docs and implemented behavior

## Product Principle

The product is not "16 tools." The product is "the fastest possible write -> run -> inspect -> fix -> rerun loop for an AI agent working on Cypress tests."

Every tool that does not materially improve that loop should be cut, collapsed, or deferred.

## Recommended v1 Scope

### Keep

- `cypress_discover`
- `cypress_analyze_spec`
- `cypress_list_specs`
- `cypress_run_spec`
- `cypress_run_test`
- `cypress_get_last_run`
- `cypress_get_screenshot`
- `cypress_get_env`
- `cypress_install` or a renamed `cypress_doctor`

### Add

- `cypress_get_failure_context`
  - The missing tool for vibe-coding workflows
  - Returns a compact debugging bundle for one failed test:
    - run metadata
    - failing test title/full title
    - error message
    - best-effort stack location
    - screenshot paths
    - spec file excerpt around the failure
    - suggested next actions
- `cypress_rerun_last`
  - Replays the last `run_spec` or `run_test` invocation from state
  - Removes friction when the agent is iterating on the same failure

### Defer

- `cypress_authenticate`
- `cypress_check_auth`
- `cypress_get_test_replay`
- `cypress_clear_downloads`
- `cypress_get_support_file`
- `cypress_validate_config` as a standalone tool if `cypress_doctor` exists

## Revised Tool Set

### Essential loop

- `cypress_discover`
- `cypress_analyze_spec`
- `cypress_list_specs`
- `cypress_run_spec`
- `cypress_run_test`
- `cypress_rerun_last`
- `cypress_get_last_run`
- `cypress_get_failure_context`
- `cypress_get_screenshot`

### Environment and setup

- `cypress_get_env`
- `cypress_doctor`

That gives a focused v1 of 11 tools instead of 16 uneven ones.

## Required Design Changes

### 1. Promote run state to a first-class model

`StateStore` should track:

- `runId`
- timestamp
- command kind: `run_spec` or `run_test`
- original args
- parsed result
- stdout/stderr tail
- screenshot list

This enables `cypress_rerun_last`, `cypress_get_last_run`, and `cypress_get_failure_context` to work cleanly.

### 2. Standardize tool output

Every tool should return a consistent envelope:

```json
{
  "ok": true,
  "tool": "cypress_run_spec",
  "summary": "1 failing test in auth/login.cy.ts",
  "data": {},
  "nextActions": ["cypress_get_failure_context", "cypress_get_screenshot"]
}
```

This is more agent-friendly than unrelated JSON shapes per tool.

### 3. Make failure inspection a first-class workflow

`cypress_run_spec` and `cypress_run_test` should return:

- `runId`
- structured summary
- number of failures
- first failure title
- artifact counts
- recommended next tool calls

The run tools should not force the agent to parse long JSON blobs before knowing what to do next.

### 4. Collapse validation into one onboarding tool

Replace fragmented setup checks with `cypress_doctor`:

- config file found
- Cypress binary found
- spec files found
- support file found
- screenshots/downloads dirs resolved
- optional install/verify mode

This is a better day-one tool than separate validation surfaces.

## Implementation Order

### Task 1: Stabilize the repo

- [ ] Add missing `src/tools/discovery/discover.ts`
- [ ] Align `package.json` with actual lint dependencies
- [ ] Add missing `README.md` or stop publishing it in `files`
- [ ] Verify the current source tree builds before adding new tools

Files:
- `src/tools/discovery/discover.ts`
- `package.json`
- `.eslintrc.cjs`
- `README.md`

### Task 2: Tighten tool scope

- [ ] Remove or defer weak v1 tools from registration
- [ ] Rename `cypress_install` to `cypress_doctor` or expand it to cover validation
- [ ] Make tool descriptions match actual behavior

Files:
- `src/tools/index.ts`
- `src/tools/project/install.ts`
- `src/tools/project/validate-config.ts`
- `src/tools/debug/get-test-replay.ts`
- `src/tools/auth/*.ts`

### Task 3: Upgrade run state

- [ ] Extend `StateStore` to persist run args, run ID, stderr/stdout tail, and screenshots
- [ ] Record enough metadata to rerun the last command exactly

Files:
- `src/services/state-store.ts`
- `src/tools/core/run-spec.ts`
- `src/tools/core/run-test.ts`
- `src/types/results.ts`
- `src/types/cypress.ts`

### Task 4: Add the missing feedback-loop tools

- [ ] Implement `cypress_rerun_last`
- [ ] Implement `cypress_get_failure_context`
- [ ] Return `nextActions` from run tools

Files:
- `src/tools/core/rerun-last.ts`
- `src/tools/debug/get-failure-context.ts`
- `src/tools/index.ts`
- `src/tools/core/run-spec.ts`
- `src/tools/core/run-test.ts`

### Task 5: Finish discovery

- [ ] Implement `cypress_discover`
- [ ] Reuse spec parsing logic between discovery and analysis where practical
- [ ] Keep regex-based parsing, but document its limits

Files:
- `src/tools/discovery/discover.ts`
- `src/tools/discovery/analyze-spec.ts`
- `src/services/spec-finder.ts`

### Task 6: Verify with tests

- [ ] Add tests for missing discovery tool
- [ ] Add tests for stateful rerun behavior
- [ ] Add tests for failure-context extraction
- [ ] Add at least one integration test for tool registration

Files:
- `test/unit/*.test.ts`
- `test/integration/server.test.ts`
- `test/integration/tools/*.test.ts`

## Open Questions Resolved For v1

- Auth should be deferred unless the server adopts a plugin or command-hook model.
- Cypress Cloud replay should be deferred until run metadata can reliably capture replay URLs.
- Licensing docs should exist, but licensing work should not drive tool design.

## Success Criteria

### Automated

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds
- [ ] `npm test` succeeds
- [ ] Tool registration test confirms only the intended v1 tools are exposed

### Manual

- [ ] From an MCP client, discover a fixture project, run one failing spec, inspect failure context, fix the spec, and rerun without leaving the chat

## Recommendation

Ship the smallest product that makes an AI agent materially better at Cypress iteration. That means investing in run state, reruns, and failure-context packaging before adding project-specific auth helpers or Cloud-adjacent utilities.
