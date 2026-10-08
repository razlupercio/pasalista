# ADR-0003: Multi-tenancy model

- Status: Proposed
- Date: 2026-10-08

## Context

The project must be ready for a hosted offering with tenant isolation, without building
billing or team management in the MVP.

## Decision

- The tenant is the **organization**. Better Auth's organization plugin provides
  `organizations`, `organization_members` (roles `owner`, `admin`, `member`) and
  `organization_invitations`.
- Every user gets a **personal organization** on sign-up. The MVP UI works only with it.
- Every tenant-scoped table carries `organization_id`. The API resolves the caller's
  organization (or event staff assignment) per request, and all data access goes through a
  scoped repository helper; review and lint rules forbid unscoped queries on tenant tables.
- Staff are assigned per event (`event_staff`) and do not become organization members.
- Shared database, shared schema. **No Postgres row-level security in the MVP**; the
  `organization_id` columns make adding RLS later a migration, not a redesign.

## Consequences

- One deployment can serve many organizations safely as long as the service layer is
  correct; an authorization test matrix per route covers it.
- Team features (co-organizers) and billing can be added later without changing existing
  tables.

## Alternatives considered

- **User-owned events (no organizations):** simpler now, painful migration later.
- **Schema or database per tenant:** strong isolation, heavy operations for a
  self-hosted-first project.
- **RLS from day one:** extra complexity with Drizzle and connection pooling; deferred.
