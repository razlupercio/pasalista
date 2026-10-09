# PasaLista

Open source event attendance validation with signed QR codes. Create an event, register
attendees (open signup or a closed guest list), and check them in at the door, even offline.

> Status: **v0.1.0**, first public release. Ready to try and to self-host for small and
> medium events; expect rough edges. See the [roadmap](docs/ROADMAP.md) and the
> [changelog](CHANGELOG.md).

## Features

- **Events** with open registration (public link) or a closed guest list (CSV import up to
  2,000 rows), capacity, deadline and custom questions.
- **Tickets** by email with a QR code signed with Ed25519 (one key per event, rotation and
  revocation). Attendees can see or cancel their ticket from a private link.
- **Scanner** in the browser (phone camera) or manual search, for organizers and invited staff.
  Each person is checked in once, even with simultaneous scans.
- **Offline mode**: the scanner keeps working without connection and syncs when it returns;
  duplicates across devices are detected and reported.
- **Live stats, CSV export and audit log** of who checked in whom and when.
- **Privacy**: minimal data, and organizers can purge an event's personal data while keeping its
  totals.
- Spanish (Mexico) and English, light and dark mode, mobile first, WCAG AA checks.

## Quickstart (5 minutes)

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/razlupercio/pasalista.git
cd pasalista
docker compose up --build
```

Then, with the stack running:

1. Open <http://localhost:3000> and create an account.
2. Open the verification email in Mailpit (<http://localhost:8025>) and follow the link.
3. Create an event, publish it and open its public registration link.
4. Register with any email; the ticket with its QR code arrives in Mailpit.
5. Back on the event, open the scanner on your phone or another tab, and scan the QR (or search
   the guest by name). The stats update live.

The stack runs with development defaults; see [`.env.example`](.env.example) to change them.
To run PasaLista for real events, follow the [deployment guide](docs/DEPLOYMENT.md): it needs
HTTPS (the camera only works on secure origins) and your own secrets.

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

## Contributing

Contributions are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately. See [`SECURITY.md`](SECURITY.md). The OWASP ASVS
level 1 review is in [`docs/security/ASVS-L1.md`](docs/security/ASVS-L1.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
