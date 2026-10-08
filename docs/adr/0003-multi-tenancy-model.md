# ADR-0003: Multi-tenancy model

- Status: Proposed
- Date: 2026-10-08

## Context

The project must be ready for a hosted offering with tenant isolation, without building
billing. The maintainer confirmed in Phase 0 that several people must be able to manage the
same events in the MVP (basic teams).

## Decision

- The tenant is the **organization**. Better Auth's organization plugin provides
  `organizations`, `organization_members` (roles `owner`, `admin`, `member`) and
  `organization_invitations`.
- Every user gets a **personal organization** on sign-up. Users can create more
  organizations, switch the active one and invite co-organizers by email. Roles: `owner`
  (everything, including deleting the organization), `admin` (also manages members),
  `member` (manages the organization's events).
- Every tenant-scoped table carries `organization_id`. The API resolves the caller's
  organization (or event staff assignment) per request, and all data access goes through a
  scoped repository helper; review and lint rules forbid unscoped queries on tenant tables.
- Staff are assigned per event (`event_staff`) and do not become organization members.
- Shared database, shared schema. **No Postgres row-level security in the MVP**; the
  `organization_id` columns make adding RLS later a migration, not a redesign.

## Consequences

- One deployment can serve many organizations safely as long as the service layer is
  correct; an authorization test matrix per route covers it.
- Billing can be added later per organization without changing existing tables.
- The authorization matrix grows with three organization roles plus staff; every route is
  tested against each of them.

## Alternatives considered

- **User-owned events (no organizations):** simpler now, painful migration later.
- **Schema or database per tenant:** strong isolation, heavy operations for a
  self-hosted-first project.
- **RLS from day one:** extra complexity with Drizzle and connection pooling; deferred.
