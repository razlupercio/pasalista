# Contributing to PasaLista

Thanks for your interest! PasaLista is free software (AGPL-3.0-or-later) and welcomes bug
reports, documentation, translations and code. By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs and ideas:** open an issue first. For anything bigger than a small fix, describe the
  problem and your proposal so we can agree on the approach before you write code.
- **Security issues:** never in public issues; see [`SECURITY.md`](SECURITY.md).
- **Scope:** the MVP deliberately leaves out payments, ticket sales, multiple ticket types and
  wallet passes (see [`docs/ROADMAP.md`](docs/ROADMAP.md)).

## Setup

Follow "Development" in the [README](README.md): Node.js 24+, pnpm 10 and Docker. The whole
stack runs with `docker compose up --build`; for day-to-day work run the database and Mailpit in
Docker and the apps with `pnpm dev`.

## How the code is organized

- `packages/core` holds schemas, domain rules and QR tokens. It must stay platform-agnostic (no
  Node APIs, no DOM) because the future mobile app reuses it.
- `apps/api` holds all business logic. `apps/web` is UI only and talks to the API through the
  generated, typed client (`packages/api-client`).
- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the [ADRs](docs/adr/) before changing
  how something works. Significant decisions get a new ADR in the same pull request.

## Conventions

- **Language:** code, comments, commits, issues and docs in English. UI text always goes
  through the message catalogs in `packages/i18n` (es-MX and en); never hardcode strings.
- **TypeScript strict**, no `any` without a comment explaining why.
- **Validation:** every API input uses a Zod schema from `packages/core`; database access only
  through Drizzle (no SQL built from strings).
- **Security:** authorization checks on every resource, no personal data, tokens or keys in logs.
  See the rules in [`docs/security/ASVS-L1.md`](docs/security/ASVS-L1.md).
- **Accessibility:** mobile first, WCAG AA, light and dark mode.
- **License header:** every new source file starts with
  `// SPDX-License-Identifier: AGPL-3.0-or-later` (`pnpm lint` checks it).
- **Dependencies:** justify new ones in the pull request (license compatible with AGPL-3.0,
  actively maintained, size). Fewer is better.

## Tests

Tests are required for QR token generation and verification, check-in idempotency,
authorization and offline sync, and expected for any behavior change.

```bash
pnpm lint && pnpm typecheck && pnpm test   # must pass before you open a pull request
pnpm test:e2e                              # Playwright, against a running stack (see README)
```

If you change the database schema, run `pnpm db:generate` and commit the migration. If you
change API routes or schemas, run `pnpm openapi:generate` and commit the generated files. CI
fails when they are out of date.

## Commits and pull requests

- Branch from `main`; never push to `main` directly.
- Small commits following [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `ci:`...).
- One topic per pull request. Describe what changes and why, and how you tested it.
- CI (lint, typecheck, unit/integration tests, dependency audit and e2e) must be green.

## License of contributions

By submitting a contribution you agree that it is licensed under AGPL-3.0-or-later, the
project's license.
