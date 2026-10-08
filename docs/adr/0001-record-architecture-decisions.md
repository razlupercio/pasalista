# ADR-0001: Record architecture decisions

- Status: Proposed
- Date: 2026-10-08

## Context

PasaLista is an open source project that will have external contributors. Decisions made
during ideation live in `docs/DECISIONS.md`; new technical decisions need a durable,
reviewable record.

## Decision

Use lightweight Architecture Decision Records in `docs/adr/`, numbered `NNNN-title.md`, with
the sections Context, Decision, Consequences (and Alternatives when relevant). Statuses:
Draft, Proposed, Accepted, Superseded by ADR-NNNN. An ADR is accepted when the PR that
introduces it is merged with maintainer approval. Accepted ADRs are not edited; they are
superseded.

## Consequences

- Every significant change to the stack, data model, security model or protocols gets an ADR.
- `docs/DECISIONS.md` stays as the historical pre-Phase 0 log.
