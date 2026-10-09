# ADR-0009: Online check-in and scanner

- Status: Proposed
- Date: 2026-10-08

## Context

Phase 4a adds the scanner and online check-in. The brief requires idempotent check-in (two
simultaneous scans produce one check-in), an audit trail of who validated what and when, and a
fast scanner on staff phones. The maintainer decided during Phase 4a: check-in opens 6 hours
before the start and closes at the end (12 hours after the start when there is no end time);
only organizers can undo a check-in; staff see names and partial emails in manual search.

## Decision

**Protocol.** `POST /api/v1/events/{id}/check-ins` takes a QR token or an attendee id plus a
device-generated `clientCheckInId` (UUID). Business outcomes (`valid`, `already_used`,
`invalid`, `wrong_event`, `revoked`, `outside_window`) are 200 responses so scanners render them
directly; access problems are 401/404.

**Verification order** follows ADR-0002: token format and signature (active and retired key
versions), event match, then the ticket's nonce and key version must equal the attendee's
active ticket. Superseded, revoked and cancelled tickets answer `revoked`.

**Idempotency.** `check_ins` has `UNIQUE (event_id, attendee_id)` and
`UNIQUE (client_check_in_id)`; the insert uses `ON CONFLICT DO NOTHING`. The database decides
races without locks: concurrent scans of one ticket create exactly one row and the others answer
`already_used` with the first check-in time. A retried request with the same client id gets the
same `valid` answer. Phase 4b offline sync reuses the same constraints.

**Audit.** Every scan is stored in `check_in_attempts` (who, device, outcome, time). Organizer
actions (publishing, key rotation, guest list changes, ticket operations, staff changes, undoing
check-ins) go to `audit_log` with ids and counts only, never personal data.

**Who scans.** Members of the owning organization and staff assigned to the event. Only
organizers undo check-ins, see stats or export the list.

**Scanner.** `@yudiel/react-qr-scanner` (MIT; uses the native BarcodeDetector or the zxing
WebAssembly decoder). The decoder's `.wasm` is copied from `node_modules` at build time and
served from our origin: by default it would be fetched from a third-party CDN, leaking usage,
breaking offline use and conflicting with a strict CSP. Camera constraints are preferences only,
so laptops and low-resolution webcams work. The camera is allowed by `Permissions-Policy` on
`/{locale}/scan/*` only.

**Dashboard.** Polling every 5 s with `If-None-Match` (weak ETag) as planned in
ARCHITECTURE.md §10; SSE stays a later option.

**CSV export.** RFC 4180 with a UTF-8 BOM; cells starting with `=`, `+`, `-`, `@`, tab or CR are
prefixed with `'` to prevent CSV/formula injection in spreadsheets.

## Consequences

- Check-in correctness does not depend on application locking; it holds across API instances.
- The audit trail grows with every scan; retention and purge are part of Phase 5.
- E2E tests drive the real scanner with Chromium's fake camera fed a generated video of the QR.
