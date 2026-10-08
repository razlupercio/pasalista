# Data model

> Status: **Proposed** (Phase 0). PostgreSQL 18 + Drizzle ORM. See
> [`ARCHITECTURE.md`](ARCHITECTURE.md) for context.

## Conventions

- Table names: plural `snake_case`. Columns: `snake_case`. Timestamps: `timestamptz`, UTC.
- Primary keys: `uuid` generated with `uuidv7()` (time-ordered, good index locality,
  74 random bits, not enumerable). Never sequential integers in anything exposed.
- Every tenant-scoped table has `organization_id` (denormalized where useful) so queries
  can always be scoped and a future row-level-security policy is trivial to add.
- Emails stored lowercased and trimmed (`email` column, `citext` not required).
- Secrets (access tokens, invitation tokens) are stored only as SHA-256 hashes.
- Enums as Postgres enums managed by Drizzle migrations.

## Changes from the brief's initial list

The brief proposed `users, events, event_staff, attendees/registrations, check_ins,
invitations, audit_log`. Proposed adjustments:

| Change                                                                           | Why                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add `organizations` + `organization_members` (+ Better Auth tables)              | Multi-tenant isolation from day one; Better Auth's organization plugin provides them.                                                                                    |
| Merge "attendees/registrations" into `attendees`                                 | One row per person per event regardless of how they arrived (`source` column).                                                                                           |
| Add `tickets`                                                                    | Separates the person from their QR credential: reissue/revoke without touching the attendee; keeps history.                                                              |
| Add `event_signing_keys`                                                         | Per-event Ed25519 keys with versions, rotation and revocation.                                                                                                           |
| Split "invitations" into `staff_invitations` (and Better Auth's org invitations) | Closed-list attendees get their ticket directly (confirmed in Phase 0), so attendee "invitation" is just an `attendees` row with `source = import/manual` plus an email. |
| Add `check_in_attempts`                                                          | Every scan outcome (invalid, wrong event, duplicates from offline sync): audit trail and dashboard reporting without polluting `check_ins`.                              |
| Add `email_outbox`                                                               | Reliable, retryable email delivery in the same transaction as the business change.                                                                                       |

## ER diagram

```mermaid
erDiagram
  users ||--o{ sessions : has
  users ||--o{ accounts : has
  users ||--o{ organization_members : "belongs via"
  organizations ||--o{ organization_members : has
  organizations ||--o{ organization_invitations : has
  organizations ||--o{ events : owns
  events ||--o{ event_signing_keys : "signs with"
  events ||--o{ event_staff : "assigns"
  users ||--o{ event_staff : "works as"
  events ||--o{ staff_invitations : has
  events ||--o{ attendees : has
  attendees ||--o{ tickets : "holds"
  event_signing_keys ||--o{ tickets : "signed by"
  attendees ||--o| check_ins : "checked in"
  tickets ||--o{ check_ins : "used in"
  users ||--o{ check_ins : "validated by"
  events ||--o{ check_in_attempts : logs
  organizations ||--o{ audit_log : records
  organizations ||--o{ email_outbox : queues

  users {
    uuid id PK
    text email UK
    boolean email_verified
    text name
    text locale
    timestamptz created_at
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text token UK "hashed by Better Auth"
    timestamptz expires_at
    uuid active_organization_id
  }
  accounts {
    uuid id PK
    uuid user_id FK
    text provider_id
    text password_hash "credential provider only"
  }
  organizations {
    uuid id PK
    text name
    text slug UK
    boolean is_personal
    timestamptz created_at
  }
  organization_members {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    enum role "owner | admin | member"
  }
  organization_invitations {
    uuid id PK
    uuid organization_id FK
    text email
    enum role
    enum status
    timestamptz expires_at
  }
  events {
    uuid id PK
    uuid organization_id FK
    text slug UK "public URL"
    text name
    text description
    timestamptz starts_at
    timestamptz ends_at
    text timezone "IANA"
    text venue_name
    text venue_address
    int capacity "nullable"
    enum registration_mode "open | closed"
    timestamptz registration_deadline "nullable"
    jsonb registration_fields "extra field definitions, Zod-validated"
    enum status "draft | published | closed"
    uuid created_by FK
    timestamptz created_at
    timestamptz updated_at
  }
  event_signing_keys {
    uuid id PK
    uuid event_id FK
    int version "UK with event_id"
    bytea public_key "32 bytes"
    bytea private_key_ciphertext "AES-256-GCM"
    text kek_id "master key id, for rotation"
    enum status "active | retired | revoked"
    timestamptz created_at
    timestamptz revoked_at
  }
  event_staff {
    uuid event_id PK
    uuid user_id PK
    uuid organization_id FK
    uuid added_by FK
    timestamptz created_at
  }
  staff_invitations {
    uuid id PK
    uuid event_id FK
    text email
    bytea token_hash UK
    timestamptz expires_at
    timestamptz accepted_at
    uuid invited_by FK
  }
  attendees {
    uuid id PK
    uuid event_id FK
    uuid organization_id FK
    text name
    text email "UK with event_id"
    text locale
    enum source "open_registration | import | manual"
    enum status "active | cancelled"
    jsonb answers "extra field answers"
    bytea ticket_access_hash UK "my-ticket link"
    timestamptz created_at
    timestamptz updated_at
    timestamptz cancelled_at "re-registration reactivates the row"
  }
  tickets {
    uuid id PK
    uuid attendee_id FK
    uuid event_id FK
    int key_version
    bytea nonce "12 random bytes"
    enum status "active | superseded | revoked"
    timestamptz issued_at
    timestamptz revoked_at
    text revoked_reason
  }
  check_ins {
    uuid id PK
    uuid event_id FK "UK with attendee_id"
    uuid attendee_id FK
    uuid ticket_id FK "nullable for manual"
    uuid scanned_by FK
    uuid client_check_in_id UK
    text device_id
    enum method "qr | manual"
    enum mode "online | offline"
    timestamptz scanned_at "device clock"
    timestamptz received_at "server clock"
  }
  check_in_attempts {
    uuid id PK
    uuid event_id FK
    uuid organization_id FK
    uuid attendee_id "nullable if unparseable"
    uuid scanned_by FK
    uuid client_check_in_id
    text device_id
    enum outcome "valid | already_used | invalid | wrong_event | revoked | duplicate_offline"
    timestamptz scanned_at
    timestamptz received_at
  }
  audit_log {
    uuid id PK
    uuid organization_id FK
    uuid actor_user_id FK
    uuid event_id "nullable"
    text action "e.g. event.publish, ticket.revoke"
    text entity_type
    uuid entity_id
    jsonb metadata "never personal data"
    timestamptz created_at
  }
  email_outbox {
    uuid id PK
    uuid organization_id FK
    uuid event_id "nullable"
    text kind "ticket | staff_invite | reset_password"
    text to_email
    text locale
    jsonb payload
    enum status "pending | sent | failed"
    int attempts
    timestamptz next_attempt_at
    timestamptz sent_at
  }
```

Better Auth also uses a `verifications` table (email verification, magic link, reset tokens);
it is omitted from the diagram for readability.

## Key constraints and indexes

| Table                | Constraint / index                                                                | Purpose                                                  |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `events`             | `UNIQUE (slug)`; index `(organization_id, starts_at)`                             | public URLs; organizer listing                           |
| `event_signing_keys` | `UNIQUE (event_id, version)`; partial `UNIQUE (event_id) WHERE status = 'active'` | exactly one active key per event                         |
| `attendees`          | `UNIQUE (event_id, email)`                                                        | no duplicate registrations; closed-list whitelist lookup |
| `tickets`            | partial `UNIQUE (attendee_id) WHERE status = 'active'`                            | one valid QR per attendee                                |
| `check_ins`          | `UNIQUE (event_id, attendee_id)`                                                  | **idempotent check-in** (single entry)                   |
| `check_ins`          | `UNIQUE (client_check_in_id)`                                                     | **idempotent offline sync**                              |
| `check_in_attempts`  | index `(event_id, received_at DESC)`                                              | dashboard feed, duplicate report                         |
| `event_staff`        | PK `(event_id, user_id)`; index `(user_id)`                                       | staff authorization lookup                               |
| `email_outbox`       | index `(status, next_attempt_at)`                                                 | worker polling                                           |

## Deletion and privacy

- **Delete event data** (organizer action): one transaction deletes attendees, tickets,
  check-ins, attempts, staff invitations, outbox rows and signing keys of the event (FK
  `ON DELETE CASCADE` from `events`), then the event itself. An `audit_log` entry
  `event.purge` keeps only IDs and counts.
- `audit_log.metadata` and logs never contain names, emails or tokens.
- Account deletion: Better Auth user deletion; events owned through the organization are
  handled by the organization owner.
