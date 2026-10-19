# Security Policy

## Supported versions

Only the latest release on npm gets security fixes.

## Reporting a vulnerability

Report it privately through [GitHub security advisories](https://github.com/jams4code/cypress-mcp/security/advisories/new). Do not open a public issue.

You get an answer within 3 working days. Confirmed issues are fixed and released as soon as possible, and credited in the release notes unless you prefer otherwise.

## Scope

cypress-mcp runs Cypress on the developer's machine with the arguments an agent sends. Issues that matter most:

- Command injection through spec paths, test names or env values
- Reading or running files outside the project root
- Leaking `CYPRESS_RECORD_KEY` or values from `cypress.env.json`
