# PasaLista — Project Brief

> Source of truth for the project. Claude Code must read this file at the start of every session.
> Suggested first instruction: "Read CLAUDE.md and docs/PROJECT_BRIEF.md and start Phase 0 in plan mode."

Act as a senior software architect and full-stack developer. We are building an OPEN SOURCE
project called **PasaLista**: a platform to manage events and validate attendance using QR codes.
We start as a web application, but the architecture must allow scaling and adding a native
mobile app later without rewriting business logic.

## GOAL
An organizer creates an event, defines how attendees register and, on the day of the event,
staff scan QR codes to validate entry. Simple, fast and reliable, even without internet.

## STACK (all open source, self-hostable)
- Monorepo: pnpm workspaces + Turborepo
- Language: strict TypeScript across the whole project
- `apps/web`: Next.js (App Router) + Tailwind CSS + shadcn/ui, configured as a PWA
- `apps/api`: Hono (Node) with Zod validation; exposes a REST API with OpenAPI
  (business logic does NOT live in Next.js, so the mobile app consumes the same API)
- `packages/core`: types, Zod schemas, QR token generation/verification and domain rules
  (shared by web, api and the future mobile app; no Node or DOM dependencies)
- `packages/db`: PostgreSQL + Drizzle ORM with migrations
- Auth: Better Auth (email/password + magic link; optional OAuth)
- QR: `qrcode` to generate; `@yudiel/react-qr-scanner` (or `qr-scanner`) to scan in the browser
- Email: Nodemailer + SMTP (Mailpit in development)
- Infra: Docker + docker-compose (api, web, postgres, mailpit); complete `.env.example`
- Quality: ESLint, Prettier, Vitest (unit), Playwright (e2e for critical flows), GitHub Actions CI
- Future (do NOT implement now, just do not block it): mobile app with Expo / React Native
  reusing `packages/core` and consuming `apps/api`

## ROLES
- Organizer (event owner)
- Staff / scanner (limited access: only validate attendance for assigned events)
- Attendee (registers, receives and shows their QR)

## FEATURES (MVP)
1. Auth: sign up, log in, log out, password recovery.
2. Events (CRUD): name, description, date/time, time zone, venue, optional capacity,
   registration mode, status (draft/published/closed).
3. Two registration modes per event:
   a) OPEN: public page with a link/slug where anyone registers (name, email, optional
      extra fields). Optional maximum capacity and deadline.
   b) CLOSED LIST: the organizer uploads attendees manually or via CSV; only they receive
      an invitation with their QR by email. Uninvited registrations are rejected.
4. QR per attendee: generated on registration/invitation, sent by email and shown on a
   "my ticket" page (downloadable and addable to the home screen).
5. Attendance validation (scanner mode, optimized for phones):
   - Scans the QR with the camera and answers with a large, clear status:
     VALID (with name) / ALREADY USED (with first check-in time) / INVALID / WRONG EVENT.
   - Manual check-in by name/email search as a fallback.
   - Idempotent operation: two simultaneous scans of the same QR do not create two check-ins.
6. Event dashboard: registered, attended, no-shows, real-time check-ins (SSE or polling),
   filterable list and CSV export.
7. Staff management: the organizer invites scanners to an event.

## QR AND SECURITY (first-class requirement)
- QR token signed with **Ed25519** (per-event key). The server signs; the scanner only
  receives the event's public key, so it can verify authenticity WITHOUT network access
  and without exposing secrets. Minimal payload: eventId, attendeeId (UUIDv7/random),
  key version, nonce. Never sequential or predictable IDs.
- Support key rotation and revocation (revocation list syncable to the scanner).
- Ability to revoke and regenerate an attendee's QR.
- Server-side verification whenever there is network access.
- Rate limiting on public endpoints (registration, validation, login).
- Resource-level authorization (an organizer only sees their events; staff only assigned ones).
- Zod validation on all inputs, parameterized queries (Drizzle), security headers,
  correct CSRF/CORS, no secrets in the repo.
- Reference: OWASP ASVS level 1. Privacy: store only necessary data and allow deleting an
  event's data.
- Audit trail: record who validated what and when.

## OFFLINE MODE (implemented in Phase 4b)
- PWA scanner with Service Worker + IndexedDB: before the event it downloads the public key,
  the attendee list (minimal hashes/IDs) and the revocation list.
- Offline check-ins queued locally with `clientCheckInId` (UUID) + timestamp + `deviceId`;
  automatic sync when the network returns, idempotent (UNIQUE in the DB).
- Documented conflict resolution: two devices validate the same QR offline → the oldest
  timestamp wins, the other is marked as duplicate and reported on the dashboard.
- Clear status indicator (online / offline / pending sync).
- E2E tests that simulate network loss.

## DESIGN FOR SCALE
- Versioned API (`/v1`), contracts defined with Zod + OpenAPI, to generate typed clients.
- Check-in with a UNIQUE constraint in the database and a transaction to guarantee idempotency.
- Initial data model (adjust it if you see improvements and justify it): users, events,
  event_staff, attendees/registrations, check_ins, invitations, audit_log.
- Multi-tenant ready (future hosted offering): isolation per organization from the data model.
- i18n from the start (es-MX and en) with next-intl or equivalent.

## UX
- Mobile-first, accessible (WCAG AA), light/dark mode.
- Scanner flow: at most 2 taps to start scanning; visual and haptic/sound feedback.

## LICENSE AND SUSTAINABILITY MODEL
- AGPL-3.0 (`AGPL-3.0-or-later`). Include LICENSE (already present), SPDX headers and a README
  section on donations (GitHub Sponsors / Open Collective) and a commercial license option.
- Model: free open source; commercial license for those who do not want to comply with AGPL;
  paid hosted version for those who do not want to self-host.

## OUT OF MVP (v2)
Payments, ticket sales, multiple ticket types, wallet passes (Apple/Google Wallet).

## WORKFLOW
Work in phases and do NOT advance to the next without my confirmation:
- **Phase 0:** architecture proposal, folder structure, data model (ER diagram in
  Mermaid) and milestone plan. Ask me about anything ambiguous BEFORE writing code.
- **Phase 1:** monorepo scaffolding, Docker Compose, CI, DB + migrations, auth.
- **Phase 2:** events + open registration + QR generation + emails.
- **Phase 3:** closed list + CSV + invitations.
- **Phase 4a:** PWA scanner + idempotent check-in (online) + dashboard.
- **Phase 4b:** offline mode (Service Worker, IndexedDB, sync queue, conflict resolution).
- **Phase 5:** security hardening, e2e tests, README, CONTRIBUTING, deployment documentation.

In each phase: briefly explain decisions, include tests for what is critical (token
generation and verification, check-in idempotency, authorization, offline sync) and leave the
app running with `docker compose up`.

## OPEN SOURCE REPO DELIVERABLES
Clear README (5-minute quickstart), `.env.example`, CONTRIBUTING.md, CODE_OF_CONDUCT.md,
SECURITY.md, issue/PR templates, Dependabot and CodeQL enabled.
