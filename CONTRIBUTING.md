# Contributing to cypress-mcp

Thanks for your interest in contributing.

## Getting Started

1. Fork the repo
2. Clone your fork
3. Install dependencies: `npm install`
4. Build: `npm run build`
5. Run tests: `npm test`

## Development

```bash
npm run dev          # Watch mode (rebuilds on change)
npm run typecheck    # Type checking
npm run lint         # Linting
npm run format       # Format code
npm test             # Run tests
```

### E2E against real Cypress

`test/e2e/smoke.mjs` drives `test/e2e/project` (CommonJS config, junit reporter) through the built server over stdio, the way an agent does, then the TS (ESM and CJS) and MJS projects in `test/e2e/projects` through the CLI. Run it whenever run, wrapper, runtime or CLI handling changes:

```bash
npm run build
npm install --prefix test/e2e --no-save --no-package-lock cypress@latest @cypress/grep@latest typescript@5
node test/e2e/smoke.mjs
```

`runtime/` is what Cypress loads during a run: `config.cjs` wraps the project's config (it runs in Cypress's config process), `support.js` runs in the browser. Both are plain JavaScript that every supported Cypress and browser must accept; their unit tests run them in Node (`test/unit/runtime-*.test.ts`), the smoke test in a real browser.

CI runs it on Cypress 14 (Linux) and the latest Cypress (Linux and Windows) for every PR, and weekly so a new Cypress release that breaks something is caught before users hit it.

## Project Structure

- `src/tools/`: One file per MCP tool. `run.ts` and `get-failure.ts` are the default loop; `src/tools/index.ts` decides which tools each `--caps` group adds
- `src/format/compact.ts`: The text agents read, for the tools and the CLI
- `src/cli.ts`: `cypress-mcp run <spec>`
- `src/services/`: Business logic (process manager, run executor, failure context, parser, config loader)
- `src/utils/`: Shared utilities (logger, paths, errors, sanitize)
- `src/types/`: TypeScript type definitions
- `test/unit`, `test/integration`: Vitest suites
- `test/e2e`: real Cypress project and the smoke driver

## Adding a New Tool

1. Create a file in `src/tools/`, exporting a `register` function that calls `server.registerTool` with a `title`, annotations (`READ_ONLY` or `RUNS_CYPRESS` from `src/tools/result.ts`), an `outputSchema` built with `envelopeSchema`, and a handler that returns `textResult(...)` or `errorResult(...)`
2. Register it in `src/tools/index.ts`. A new tool goes in an optional `--caps` group unless agents need it in every session: each default tool costs context in every client
3. Add tests: the integration tests list the tools and check `structuredContent` against the `outputSchema`
4. Update README.md

## Pull Requests

- Branch from `main` (`fix/...`, `feat/...`, `ci/...`, `docs/...`). Nothing is pushed to `main` directly.
- One change per PR, with a test for new behavior
- PR title in conventional commit form (`fix:`, `feat:`, `docs:`, `ci:`, `chore:`; `feat!:` for breaking). PRs are squash-merged, so the title becomes the commit.
- Run `npm run typecheck && npm run lint && npm run format:check && npm test` before pushing
- Merge needs green CI (3 OSes, Node 22 and 24), E2E and CodeQL

Dependabot opens grouped dependency PRs every Monday. The runtime dependencies are bundled into `dist/index.js` and are listed under `devDependencies`, so a bump of one of them (the `bundled` group) only reaches users with the next release: release after a security fix in one of them. `node scripts/audit-prod.mjs` (after `npm run build`) fails on advisories in the bundled packages.

## Code Style

- TypeScript strict mode
- No `any` types
- Prettier for formatting
- ESLint for linting

## Releasing

1. Bump `version` in `package.json` and both `version` fields in `server.json`, and add a `CHANGELOG.md` entry (a unit test fails when the two files disagree)
2. Merge to `main`, then push a matching tag: `git tag v0.3.0 && git push origin v0.3.0`
3. The release workflow checks the tag matches the versions, runs the full check, publishes to npm with provenance, creates the GitHub release, then publishes `server.json` to the official MCP Registry

Publishing uses npm trusted publishing (OIDC), so there is no npm token secret. The package's trusted publisher on npmjs.com must point at this repository and `release.yml`. If a version is already on npm, the workflow skips the publish and still creates the GitHub release.

The MCP Registry job logs in with the workflow's GitHub OIDC token, which covers the `io.github.jams4code` namespace, so it needs no secret either. The registry checks that the npm package's `mcpName` matches `server.json`, which is why it runs after the npm publish. It skips versions already in the registry. `mcp-publisher` is pinned in `release.yml` and verified against its Sigstore bundle before it runs.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0, the same license as the project.
