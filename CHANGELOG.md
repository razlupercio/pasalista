# Changelog

All notable changes to PasaLista are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may include breaking
changes; they are called out in this file.

## [Unreleased]

## [0.1.0] - 2026-10-09

First public release.

### Added

- **Accounts and teams:** sign-up with email verification, password and magic-link sign-in,
  password reset, organizations with owner, admin and member roles, language (es-MX, en) and
  light/dark theme.
- **Events:** drafts, publishing and closing; open registration through a public link or a
  closed guest list; capacity, registration deadline and custom questions (text, choice,
  checkbox); time zones.
- **Guests and tickets:** CSV import of up to 2,000 guests, manual additions, invitations sent on
  demand, ticket emails with a QR code signed with Ed25519 (per-event keys, rotation and
  revocation), a private ticket page where attendees can cancel, ticket reissue, resend and
  revocation.
- **Check-in:** browser QR scanner and manual search for organizers and invited staff,
  idempotent check-in under concurrency, check-in window from 6 hours before the start, undo by
  organizers, live stats, CSV export, and a record of every scan attempt.
- **Offline mode:** installable PWA; the scanner verifies tickets locally with a downloaded
  bundle, queues check-ins and syncs them; conflicts across devices keep the earliest scan and
  report duplicates.
- **Privacy:** organizers can purge an event's personal data and keep its totals, with a reminder
  90 days after the event (ADR-0011).
- **Security:** nonce-based Content Security Policy, breached-password check (Have I Been Pwned,
  k-anonymity), rate limits on public and authentication endpoints, CSRF origin checks, audit
  log, log redaction, OWASP ASVS level 1 review (`docs/security/ASVS-L1.md`).
- **Operations:** Docker Compose stack (API, web, PostgreSQL, Mailpit), automatic migrations,
  deployment guide with Caddy (`docs/DEPLOYMENT.md`).
- **Quality:** unit, integration and Playwright end-to-end tests, including offline sync, CSP
  violations and axe accessibility checks in light and dark mode; CI with dependency audit and
  CodeQL.

[Unreleased]: https://github.com/razlupercio/pasalista/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/razlupercio/pasalista/releases/tag/v0.1.0
