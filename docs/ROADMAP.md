# Roadmap and milestones

> Status: **Proposed** (Phase 0). One branch (`phase-N/description`) and one PR per phase.
> A phase is done when its acceptance criteria pass, `pnpm lint && pnpm typecheck && pnpm test`
> is green, and the app runs with `docker compose up`. The next phase starts only after the
> maintainer approves.

## Phase 0: Proposal (this PR)

- [x] Architecture overview, folder structure ([`ARCHITECTURE.md`](ARCHITECTURE.md))
- [x] Data model and ER diagram ([`DATA_MODEL.md`](DATA_MODEL.md))
- [x] Milestones (this file)
- [x] Initial ADRs (0001 to 0004; 0005 drafted for Phase 4b)
- [ ] Maintainer answers the open questions in `ARCHITECTURE.md` §15

## Phase 1: Foundations

Scope: monorepo scaffolding, tooling, CI, database, auth.

- pnpm workspaces + Turborepo; `packages/config` (tsconfig strict, ESLint, Prettier);
  `.gitattributes` (LF line endings), `.editorconfig`, `.nvmrc`.
- `apps/api`: Hono, `/v1/health`, security headers, request IDs, `pino` with redaction,
  RFC 9457 errors, OpenAPI generation, rate-limit middleware.
- `apps/web`: Next.js + Tailwind + shadcn/ui, `next-intl` (es-MX, en), light/dark mode,
  `/api/*` rewrite to the API.
- `packages/db`: Drizzle schema for auth + organizations, first migration, seed script.
- Better Auth: sign up, sign in, sign out, password reset (via Mailpit), magic link,
  personal organization on sign-up.
- `packages/api-client` generation pipeline.
- Docker Compose: `api`, `web`, `postgres`, `mailpit`; `.env.example`.
- GitHub Actions: lint, typecheck, unit + integration tests (Postgres service), OpenAPI
  freshness check; Dependabot; CodeQL.
- Repo hygiene: SPDX headers, `SECURITY.md`, issue/PR templates.

Acceptance: a new user can sign up, receive the verification email in Mailpit, sign in and
sign out on both locales; CI is green on the PR.

## Phase 2: Events, open registration, QR, emails

- `packages/core`: Zod schemas for events/attendees; **QR token codec, sign, verify**
  (exhaustive unit tests: tampering, wrong key, wrong version, truncated input).
- Per-event signing keys with encrypted private key; key rotation endpoint.
- Events CRUD with draft/published/closed and authorization tests.
- Public event page `/e/[slug]` and open registration (capacity, deadline, extra fields),
  rate limited.
- Ticket issuance, "my ticket" page `/t/[token]` (QR, downloadable PNG, add to home screen),
  ticket email through the outbox worker.
- Reissue/revoke ticket.

Acceptance: an organizer publishes an event; a visitor registers, receives the QR by email
and opens the ticket page; registration past capacity or deadline is rejected.

## Phase 3: Closed list, CSV, invitations

- Manual attendee creation and CSV import (preview, validation report per row,
  de-duplication by email, size limits), bulk ticket emails through the outbox.
- Closed-mode public form rejects non-invited emails (flow depends on open question 1).
- Staff invitations by email; accept flow; staff list management.
- Attendee list with filters, resend ticket.

Acceptance: importing a 1,000-row CSV queues 1,000 emails without blocking the request;
invalid rows are reported; an uninvited registration is rejected.

## Phase 4a: Scanner and check-in (online) + dashboard

- Scanner route `/scan/[eventId]`: at most 2 taps from sign-in to camera, large status
  screens (VALID / ALREADY USED / INVALID / WRONG EVENT), haptic and sound feedback.
- Check-in endpoint: transactional, `ON CONFLICT DO NOTHING`, every attempt logged.
- Manual check-in by name/email search (minimal fields for staff).
- Dashboard: registered, checked in, no-shows, latest check-ins (polling), filterable
  list, CSV export.
- Audit log for check-ins, ticket revocations, staff changes, event purge.

Acceptance: a concurrency test firing N parallel check-ins for the same ticket yields
exactly one `check_ins` row and N-1 `already_used` attempts; staff cannot access events
they are not assigned to.

## Phase 4b: Offline mode

- Service worker (Serwist) and IndexedDB bundle download ("prepare for offline").
- Local verification with `packages/core`; local queue with `clientCheckInId`,
  `scannedAt`, `deviceId`; automatic sync with backoff.
- Server sync endpoint and conflict resolution (ADR-0005), duplicates on the dashboard.
- Online / offline / pending-sync indicator.

Acceptance: Playwright test with two browser contexts offline, both scanning the same QR,
then reconnecting: one check-in (earliest `scannedAt`), one reported duplicate.

## Phase 5: Hardening and release

- ASVS L1 checklist review, CSP tightening, rate-limit tuning, dependency audit.
- Full Playwright suite for critical flows; accessibility checks (axe) for WCAG AA.
- README quickstart (5 minutes), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, deployment guide.
- Event data purge UI and documentation.
- First tagged release `v0.1.0`.

## Later (v2 candidates, not in MVP)

Payments, ticket sales, multiple ticket types, wallet passes, re-entry tracking,
organization/team management UI, SSE live dashboard, native Expo app, Postgres RLS,
hosted offering and billing.
