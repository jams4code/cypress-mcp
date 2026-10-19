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

`test/e2e/smoke.mjs` drives `test/e2e/project` through the built server over stdio, the way an agent does. Run it whenever spec, run or CLI handling changes:

```bash
npm run build
npm install --prefix test/e2e/project --no-save --no-package-lock cypress@latest @cypress/grep@latest
node test/e2e/smoke.mjs
```

CI runs it on Cypress 14 (Linux) and the latest Cypress (Linux and Windows) for every PR, and weekly so a new Cypress release that breaks something is caught before users hit it.

## Project Structure

- `src/tools/`: One file per MCP tool, grouped by category
- `src/services/`: Business logic (process manager, parser, config loader)
- `src/utils/`: Shared utilities (logger, paths, errors, sanitize)
- `src/types/`: TypeScript type definitions
- `test/unit`, `test/integration`: Vitest suites
- `test/e2e`: real Cypress project and the smoke driver

## Adding a New Tool

1. Create a file in `src/tools/<category>/your-tool.ts`
2. Export a `register` function following the existing pattern
3. Import and register it in `src/tools/index.ts`
4. Add unit tests
5. Update README.md

## Pull Requests

- Branch from `main` (`fix/...`, `feat/...`, `ci/...`, `docs/...`). Nothing is pushed to `main` directly.
- One change per PR, with a test for new behavior
- PR title in conventional commit form (`fix:`, `feat:`, `docs:`, `ci:`, `chore:`; `feat!:` for breaking). PRs are squash-merged, so the title becomes the commit.
- Run `npm run typecheck && npm run lint && npm run format:check && npm test` before pushing
- Merge needs green CI (3 OSes, Node 22 and 24), E2E and CodeQL

Dependabot opens grouped dependency PRs every Monday. Production dependency bumps use `fix(deps):` so they ship in the next patch release.

## Code Style

- TypeScript strict mode
- No `any` types
- Prettier for formatting
- ESLint for linting

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry
2. Merge to `main`, then push a matching tag: `git tag v0.3.0 && git push origin v0.3.0`
3. The release workflow checks the tag matches the version, runs the full check, publishes to npm with provenance and creates the GitHub release

Publishing uses npm trusted publishing (OIDC), so there is no npm token secret. The package's trusted publisher on npmjs.com must point at this repository and `release.yml`. If a version is already on npm, the workflow skips the publish and still creates the GitHub release.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0, the same license as the project.
