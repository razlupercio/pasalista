# ADR-0007: Ticket access and attendee self-service

- Status: Proposed
- Date: 2026-10-08

## Context

Phase 2 introduces public registration and the "my ticket" page. Attendees have no accounts
(Phase 0 decision), so they need a way to reach their ticket, and the maintainer decided during
Phase 2 that a duplicate registration shows an explicit error and that attendees can cancel
their own registration.

## Decision

**Secret ticket link.** Each attendee has a random 256-bit access token, sent only in the
ticket email (`/{locale}/t/{token}`). The database stores its SHA-256 hash, never the token.
The ticket page and its API responses use `Referrer-Policy: no-referrer`, `Cache-Control:
no-store` and `noindex`. Reissuing a ticket rotates both the QR nonce and the link; the previous
link stops working.

**QR rendered on demand.** QR tokens are not stored. Ed25519 signatures are deterministic, so
the API re-signs the active ticket whenever the attendee opens the page or downloads the PNG;
the secret key is decrypted for each signature and zeroed afterwards. Emails carry the token
only in the outbox payload, which is cleared once sent.

**Duplicate registrations return an error** (`409 already_registered`). This was chosen by the
maintainer for clarity. Trade-off: anyone can learn whether an email is registered for a given
public event. Mitigations: per-IP rate limiting on registration (10/min) and no personal data in
the response. Revisit if events with sensitive attendance appear (the alternative is answering
"check your inbox" and re-sending the ticket).

**Self-cancellation.** The ticket page lets the attendee cancel. Cancelling revokes the active
ticket and frees the spot. Registering again with the same email reactivates the attendee with
a new ticket and a new link (one row per email per event is kept, `UNIQUE (event_id, email)`).

**Capacity is enforced under a row lock.** Registration locks the event row
(`SELECT … FOR UPDATE`), counts active attendees and inserts in one transaction, so concurrent
registrations cannot overbook (covered by a concurrency test).

**Secrets in paths are redacted.** Request logs and problem `instance` fields replace
token-shaped path segments with `:redacted`.

## Consequences

- Losing the ticket email means asking the organizer to reissue (resend without rotation
  arrives with the attendee list tools in Phase 3).
- Old QR codes keep a valid signature after reissue; scanners must check the nonce against the
  active ticket (ADR-0002 step 4, implemented in Phase 4).
