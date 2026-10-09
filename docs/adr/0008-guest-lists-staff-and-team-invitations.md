# ADR-0008: Guest lists, staff and team invitations

- Status: Proposed
- Date: 2026-10-08

## Context

Phase 3 adds closed guest lists (manual and CSV), staff for events and basic teams. The
maintainer decided during Phase 3: invitations are sent with an explicit "Send invitations"
action; the CSV has name, email and an optional language column; at most 2,000 rows per file;
staff and team invitations can only be accepted by an account with the invited email.

## Decision

**Pending guests.** Adding or importing guests creates active attendees with
`invitation_pending = true` and no ticket. Their placeholder access hash maps to no token, so
they have no working link. "Send invitations" (event must be published) issues tickets for all
pending guests in one transaction and queues the emails; one decrypted signing key signs the
whole batch. Re-adding a cancelled guest reactivates the row as pending and disables the old
link until a new invitation is sent.

**CSV import.** The file is parsed in the browser with a dependency-free RFC 4180 reader in
`packages/core` (delimiter detection for `,`/`;`/tab, BOM, Spanish and English headers) for a
preview, and the API re-validates every row. Invalid rows, duplicates within the file and
emails already on the list are reported by line; valid rows are added. Capacity is checked
under the event lock: an import that does not fit is rejected as a whole (`409 event_full`).

**Resend vs. reissue.** "Resend" emails the same QR with a new link (the access token is only
stored hashed, so the old link is rotated). "Reissue" creates a new QR and link.

**Staff invitations.** Single-use 256-bit tokens stored as SHA-256, valid 7 days; a new
invitation for the same email revokes the previous one. Accepting requires a session whose
verified email equals the invited email. Staff are listed in `event_staff`, see their assigned
events and cannot read or edit event data (the scanner arrives in Phase 4a).

**Teams.** Better Auth's organization plugin handles invitations, roles and membership. Its
invitation email goes through our outbox; email verification is required to accept; pending
invitations are cancelled on re-invite; organization deletion is disabled until the data purge
design in Phase 5.

**Outbox throughput.** The worker processes batches of 25 and continues immediately while
batches are full, so bulk invitations drain quickly.

## Consequences

- Organizers can prepare and correct a list before anyone is emailed.
- A guest list of 2,000 people is handled in one request without background jobs; larger lists
  are imported in several files.
- Anyone who has a staff invitation link learns the invited email and event name; the link
  itself grants nothing without signing in as that email.
