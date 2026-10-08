# PasaLista

Open source event attendance validation with signed QR codes. Create an event, register
attendees (open signup or a closed guest list), and check them in at the door, even offline.

> Status: **pre-alpha** (Phase 1 of the [roadmap](docs/ROADMAP.md): accounts and foundations).
> Events, QR tickets and the scanner arrive in the next phases.

## Quickstart

Requirements: Docker with Compose v2.

```bash
docker compose up --build
```

- App: <http://localhost:3000>
- Emails sent by the app (Mailpit): <http://localhost:8025>

Create an account, open the verification email in Mailpit and you are in. The stack runs with
development defaults; see [`.env.example`](.env.example) to change them.

## Development

Requirements: Node.js 24+, pnpm 10 (`npm install -g pnpm@10`), Docker.

```bash
pnpm install
docker compose up -d postgres mailpit   # database and email catcher
pnpm db:migrate                         # apply migrations
pnpm db:seed                            # optional: demo organizer (see below)
pnpm dev                                # API on :3001, web on :3000
```

Demo organizer created by `pnpm db:seed` (development only): `demo@pasalista.localhost` /
`demo-password-123`.

| Command                 | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `pnpm dev`              | API and web in watch mode                                    |
| `pnpm lint`             | ESLint + SPDX header check                                   |
| `pnpm typecheck`        | TypeScript in every workspace                                |
| `pnpm test`             | Unit and integration tests (needs the `postgres` service)    |
| `pnpm test:e2e`         | Playwright against a running stack (see below)               |
| `pnpm format`           | Prettier                                                     |
| `pnpm db:generate`      | Generate a migration after changing `packages/db/src/schema` |
| `pnpm db:migrate`       | Apply migrations                                             |
| `pnpm db:seed`          | Create the demo organizer                                    |
| `pnpm openapi:generate` | Regenerate `apps/api/openapi.json` and the typed API client  |

End-to-end tests simulate several clients through `X-Forwarded-For`, so run the stack with
`TRUSTED_PROXY_HOPS=1 docker compose up --build`, then `pnpm test:e2e` (first time:
`pnpm --filter @pasalista/web exec playwright install chromium`).

## Project layout

```text
apps/api          Hono API (/api/v1): auth, business logic, email outbox
apps/web          Next.js PWA: UI only, talks to the API through /api/*
packages/core     Shared Zod schemas, domain rules, IDs (platform-agnostic)
packages/db       Drizzle schema and migrations (PostgreSQL 18)
packages/i18n     Message catalogs (es-MX, en)
packages/api-client  Typed client generated from the OpenAPI document
```

Architecture, data model and decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), [`docs/adr/`](docs/adr/).

## Stack

TypeScript monorepo (pnpm + Turborepo): Next.js PWA, Hono API, PostgreSQL + Drizzle,
Better Auth, Ed25519-signed QR tokens. A native mobile app (Expo) is planned.

## Sustainability

PasaLista is free software under the [AGPL-3.0](LICENSE). To support development:

- Donations: _GitHub Sponsors / Open Collective (TBD)_
- Commercial license (if AGPL does not fit your use case): _contact TBD_
- Hosted version: _planned_

## Security

Please report vulnerabilities privately. See [`SECURITY.md`](SECURITY.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
