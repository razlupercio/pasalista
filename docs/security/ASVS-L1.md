# OWASP ASVS Level 1 review

Reviewed for `v0.1.0` against OWASP ASVS 5.0, level 1, grouped by chapter. "Met" means the
requirement is covered by code and, where noted, by tests. Chapters that do not apply to
PasaLista are listed at the end. Report vulnerabilities as described in `SECURITY.md`.

## V1 Encoding and sanitization

- **Met.** All SQL goes through Drizzle with bound parameters; there is no string-built SQL.
- **Met.** React escapes all rendered text; no `dangerouslySetInnerHTML` in the web app.
- **Met.** Email templates escape interpolated values.
- **Met.** CSV exports neutralize formula injection (cells starting with `= + - @`, tab or CR).
  Test: `packages/core/src/csv.test.ts`.

## V2 Validation and business logic

- **Met.** Every API input (body, params, query) is validated with Zod schemas shared from
  `packages/core`; invalid input answers `400 validation_failed` (RFC 9457 problem details).
- **Met.** Business limits are enforced server-side: capacity, registration deadline and
  state, the 2,000-row guest import, the check-in window, and staff/organizer roles.
- **Met.** Check-in is idempotent under concurrency (unique constraints plus transactions). Test:
  parallel check-ins in `apps/api/test/checkins.test.ts`.
- **Met.** Anti-automation: per-IP rate limits on every public endpoint (see below).

## V3 Web frontend security

- **Met.** Content Security Policy with a per-request nonce and `'strict-dynamic'`, no
  `'unsafe-eval'` in production, `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'` (ADR-0012). E2E test fails on any CSP violation.
- **Met.** `X-Content-Type-Options: nosniff`, `Referrer-Policy` (`no-referrer` on pages with
  tokens in the URL), `Permissions-Policy` (camera only on the scanner).
- **Met.** Cookies are `HttpOnly`, `SameSite=Lax`, prefixed and `Secure` when served over HTTPS.
- **Met.** Single origin (ADR-0004): the browser only talks to the web origin; the API does not
  enable CORS.
- **Met.** HSTS is sent by the API over HTTPS and by the reverse proxy in the deployment guide.

## V4 API and web service

- **Met.** Versioned under `/api/v1`, documented with OpenAPI 3.1; responses are
  `Cache-Control: no-store`; bodies over 1 MB are rejected.
- **Met.** CSRF: state-changing requests must carry an `Origin` (or `Referer`) matching
  `PUBLIC_URL`, in addition to `SameSite` cookies. Test: `apps/api/src/middleware`.

## V6 Authentication

- **Met.** Passwords: 12 to 128 characters, no composition rules, hashed with scrypt by Better
  Auth, checked against Have I Been Pwned with k-anonymity (`PASSWORD_BREACH_CHECK`).
- **Met.** Email verification required before sign-in; magic links and reset tokens are single
  use and expire (reset: 1 hour). A password reset revokes all sessions.
- **Met.** Sign-up and password-reset requests do not reveal whether an email is registered.
- **Met.** Rate limits per IP: sign-in and sign-up 5/min, magic link and reset requests 3/min,
  reset and password change 5/min.
- **Not in MVP.** Multi-factor authentication (Better Auth supports it; candidate for v2).

## V7 Session management

- **Met.** Server-side sessions in PostgreSQL with random tokens; sign-out deletes the session;
  password reset revokes all sessions.
- **Met.** Session expiry and sliding renewal use Better Auth defaults (7 days, renewed daily).

## V8 Authorization

- **Met.** Resource-level checks in every service: organization members manage only their
  organization's events (others get 404); staff only scan assigned events; only organizers undo
  check-ins; only owners and admins purge event data. Tests: `events.test.ts`,
  `checkins.test.ts`, `staff.test.ts`, `purge.test.ts`.

## V9 Self-contained tokens

- **Met.** QR tokens are Ed25519-signed per event (ADR-0002): the version and key id are
  checked, the signature is verified before any lookup, keys can be rotated and revoked, and
  tickets can be revoked individually. QR tokens never contain sequential ids. Tests:
  `packages/core/src/qr-token.test.ts`, `apps/api/test/checkins.test.ts`.

## V11 Cryptography

- **Met.** Only vetted libraries: `@noble/curves` (Ed25519), Node `crypto` (AES-256-GCM key
  wrapping, random values). Event signing keys are encrypted at rest with a key-encryption key
  from the environment; the API refuses to start in production with development secrets.

## V12 Secure communication

- **Deployment.** TLS terminates at the reverse proxy (`docs/DEPLOYMENT.md`); Postgres and SMTP
  credentials come from the environment.

## V13 Configuration

- **Met.** No secrets in the repository; `.env.example` documents every variable. Production
  refuses development secrets.
- **Met.** Dependencies: Dependabot, CodeQL, and `pnpm audit --prod --audit-level high` in CI.
  Known moderate advisory: `esbuild <= 0.24.2` reached through `drizzle-kit` (a Better Auth peer
  dependency used only for migrations); it affects esbuild's development server, which
  PasaLista never runs.
- **Met.** `X-Powered-By` is disabled; errors never expose stack traces.

## V14 Data protection

- **Met.** Data minimization: attendees provide name, email and optional organizer-defined
  answers; offline bundles carry display names only (ADR-0010).
- **Met.** Organizers can purge an event's personal data (ADR-0011); a reminder appears 90 days
  after the event.
- **Met.** API responses with personal data are `no-store`; the service worker never caches API
  responses; scanner data in IndexedDB is deleted on sign-out.

## V16 Security logging and error handling

- **Met.** Structured logs (pino) with redaction of cookies, authorization headers, passwords,
  tokens and token-shaped URL segments. Test: `apps/api/src/redact.test.ts`.
- **Met.** Audit log records who did what and when (check-ins and undo, ticket changes, staff
  changes, key rotation, event status changes, purge) with ids and counts only.
- **Met.** Every scan attempt, valid or not, is recorded per event.

## Not applicable

V5 (file handling: only CSV import, parsed in memory with a size limit), V10 (OAuth/OIDC: no
third-party sign-in in the MVP), V17 (WebRTC).

## Known limitations

- Rate limits are kept in memory: run a single API instance, or limits apply per instance.
- MFA is not available yet.
