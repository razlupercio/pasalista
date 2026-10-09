# ADR-0011: Event data purge and retention

- Status: Proposed
- Date: 2026-10-08

## Context

The brief requires that organizers can delete an event's data and that PasaLista stores only the
personal data it needs. After an event, the guest list, tickets and scan history have no further
use for most organizers, but the event itself and its totals are still useful (reports, history).

## Decision

**Purge personal data, keep the event and its totals.** `POST /v1/events/{id}/purge` deletes, in
one transaction:

- attendees (names, emails, answers) and, by cascade, their tickets;
- check-ins and every scan attempt (including offline duplicates and device ids);
- staff assignments and staff invitations (emails);
- the event's signing keys (they only verify tickets that no longer exist);
- queued or sent emails for the event. Outbox rows now carry `event_id`; rows queued before that
  column existed are matched by recipient within the organization.

The event row stays with its descriptive fields, `purged_at` and the final registered and
checked-in totals, which the API returns from then on. Custom registration questions are cleared.

**Guard rails.** Only organization owners and admins can purge, only closed events, and the
request must repeat the event slug (typed by the user in the UI). The purge is irreversible and
recorded in the audit log as `event.purge` with the totals only.

**Purged events are read-only.** Editing, publishing, key rotation, guests and staff changes
answer `409 invalid_state`. Scanner endpoints answer 404 like an unknown event, so offline devices
delete their local copy on their next refresh (ADR-0010).

**Retention is manual.** Nothing is deleted automatically. The dashboard and the event page remind
organizers when an event ended more than 90 days ago and still holds personal data
(`purgeReminderDue` in `packages/core`, shared with the future mobile app).

**Audit log.** Audit entries reference ids and counts, never personal data, so they are kept after
a purge as the record of who did what.

## Consequences

- Organizations can meet data-minimization requests per event without deleting their history.
- Automatic retention (for example in a hosted offering) can later call the same service from a
  scheduled job; it would need an organization-level setting.
- Deleting a user account or a whole organization is out of scope for this ADR.
