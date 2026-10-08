# CLAUDE.md — PasaLista

OPEN SOURCE project "PasaLista" (AGPL-3.0): a platform to manage events and validate
attendance with QR codes. It starts as a web app (PWA) and must scale to a mobile app (Expo)
without rewriting business logic. The full brief is in `docs/PROJECT_BRIEF.md`: read it at the
start of every session and treat it as the source of truth.

## Language

- Conversation with the maintainer: Spanish.
- Code, comments, commits, PRs, issues, README and repo docs: English
  (open source project, international contributors).
- UI text: i18n from day one (es-MX and en). Never hardcode user-facing strings.

## Stack (do not change without asking for confirmation)

- Monorepo: pnpm workspaces + Turborepo. Strict TypeScript everywhere.
- `apps/web`: Next.js (App Router) + Tailwind + shadcn/ui, PWA. NO business logic.
- `apps/api`: Hono (Node) + Zod + OpenAPI, versioned under `/v1`. All business logic lives here.
- `packages/core`: types, Zod schemas, QR tokens (Ed25519), domain rules.
  Must be platform-agnostic (no Node APIs, no DOM) so it can be reused in Expo.
- `packages/db`: PostgreSQL + Drizzle ORM + migrations.
- Auth: Better Auth. Email: Nodemailer (Mailpit in dev).
- Infra: Docker Compose (api, web, postgres, mailpit).
- Quality: ESLint, Prettier, Vitest, Playwright, GitHub Actions.

## Commands

Update this section as soon as they exist; do not invent commands that are not listed here.

- `pnpm install`: install dependencies
- `pnpm dev`: development
- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:e2e`
- `pnpm db:generate` / `pnpm db:migrate`
- `docker compose up`: start the whole stack

## Workflow

- We work in PHASES (0 to 5, see the brief). Do NOT move to the next phase without my
  explicit confirmation.
- Phase 0 is a proposal only: architecture, folder structure, ER diagram (Mermaid) and
  milestones. Write no code until I approve it. Ask about anything ambiguous before implementing.
- One branch per phase (`phase-N/description`) and one PR per phase. Never commit directly to `main`.
- Small commits, Conventional Commits style.
- Before calling anything done: `pnpm lint && pnpm typecheck && pnpm test` must be green.
- The app must run with `docker compose up` at the end of every phase.
- Briefly explain relevant decisions and record important ones in `docs/adr/`.

## Security rules (first-class requirement)

- QR token signed with Ed25519 (per-event key). The server signs; the scanner only holds the
  public key. Never use sequential or predictable IDs in the QR.
- Always verify server-side when online. Support key rotation and revocation.
- Idempotent check-in: UNIQUE constraint in the DB + transaction. Two simultaneous scans = one check-in.
- Zod on EVERY input. Parameterized queries only (Drizzle). No concatenated SQL.
- Resource-level authorization: an organizer only sees their own events; staff only assigned ones.
- Rate limiting on public endpoints (registration, validation, login).
- Security headers, correct CORS/CSRF. Reference: OWASP ASVS level 1.
- Privacy: store only necessary data; allow deleting an event's data.
- Audit trail: record who validated what and when.
- Never log full QR tokens, keys or personal data.

## Offline (implemented in Phase 4b)

- Service Worker + IndexedDB: the event's public key, a minimal attendee list and the
  revocation list are downloaded before the event.
- Queued check-ins with `clientCheckInId` (UUID) + timestamp + `deviceId`; idempotent sync.
- Conflicts: the oldest timestamp wins; the other is marked as duplicate and reported.

## Forbidden (do not do without asking me)

- Reading, editing or creating real `.env*` files. Only maintain `.env.example`.
- Using or requesting production secrets. Development secrets only.
- Destructive commands: `rm -rf` outside `node_modules`/build output, `git push --force`,
  `git reset --hard`, `DROP`/`TRUNCATE` outside reviewed migrations.
- Adding new dependencies without justification (AGPL-3.0-compatible license,
  active maintenance, size). Prefer few, well-maintained ones.
- Implementing anything outside the MVP: payments, ticket sales, multiple ticket types,
  wallet passes (v2 candidates).
- Deviating from the stack or the brief. If you think something should change, propose it and wait.

## Code conventions

- Strict TypeScript (`strict: true`), no `any` unless justified in a comment.
- Validation and shared types come from `packages/core`; do not duplicate schemas.
- API contracts defined with Zod + OpenAPI; typed clients are generated.
- Tests required for: token generation/verification, check-in idempotency,
  authorization and offline sync.
- SPDX header (`AGPL-3.0-or-later`) on new source files.
- Mobile-first, WCAG AA accessibility, light/dark mode.

## Multi-tenant

Keep the data model ready for a future hosted offering (isolation per organization/tenant).
Do not implement billing now; just do not block it.
