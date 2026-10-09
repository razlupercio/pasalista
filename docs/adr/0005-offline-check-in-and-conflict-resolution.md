# ADR-0005: Offline check-in and conflict resolution

- Status: Proposed (finalized in Phase 4b by ADR-0010)
- Date: 2026-10-08

## Context

Venues often have poor connectivity. Scanners must keep validating offline and later sync
without creating duplicate check-ins; conflicts between devices must be resolved
deterministically and reported.

## Decision (draft)

- Before the event, the scanner downloads an **offline bundle** for its event: public keys
  by version, revoked key versions, a minimal attendee list
  `{attendeeId, activeNonce, displayName}` (display name = first name + last initial,
  confirmed by the maintainer), revoked tickets and attendees already checked
  in. It is stored in IndexedDB and cleared when the event closes or staff access is removed.
- Offline scan: verify with `packages/core` (ADR-0002) against the bundle; if valid and not
  checked in locally, record it and enqueue
  `{clientCheckInId (UUID), attendeeId, ticketNonce, scannedAt, deviceId}`.
- Sync: `POST /v1/events/:id/check-ins/sync` with a batch. For each item, in a transaction:
  - `client_check_in_id` already stored → acknowledge (idempotent retry).
  - No check-in for the attendee → insert it.
  - Existing check-in → the **earliest `scanned_at` wins**. If the incoming one is earlier,
    it replaces the existing row and the previous one is recorded in `check_in_attempts` as
    `duplicate_offline`; otherwise the incoming one is recorded as `duplicate_offline`.
  - The response reports the outcome of each item to the device.
- Clock skew: the server records `received_at`; `scanned_at` values in the future or before
  the bundle download are clamped and flagged.
- Duplicates are listed on the dashboard with device, staff member and both timestamps.

## Open points for Phase 4b

- Bundle refresh strategy when connectivity is intermittent during the event.
