# ADR-0010: Offline scanner implementation

- Status: Proposed
- Date: 2026-10-08

## Context

ADR-0005 (drafted in Phase 0) defines the offline model: a bundle downloaded before the event,
local verification, a queue with `clientCheckInId`, `scannedAt` and `deviceId`, idempotent sync
and "earliest scan wins" conflicts. Phase 4b implements it and settles its open points.

## Decision

**Shared logic in `packages/core`.** `evaluateOfflineScan` / `evaluateOfflineManual` verify a
token against the bundle (ADR-0002 steps 1–4 plus local check-ins), so the future mobile app
reuses the exact rules. The server re-validates every synced item with the same function used for
online check-in.

**Bundle.** `GET /events/{id}/offline-bundle` returns the event window, public keys (active and
retired; revoked keys are omitted), and per active attendee: id, display name (first name + last
initial), the active ticket nonce, whether manual check-in is allowed (pending invitation) and the
current check-in time. No emails or full names leave the server. The scanner downloads it when it
opens and every 2 minutes while online; a 404 (access removed) deletes the event's local data.

**Storage.** IndexedDB through `idb` (ISC, about 1 KB): bundles, the sync queue and the attendees
checked in on this device (so a later offline scan of an online check-in is caught). Bundles are
purged a day after the check-in window closes once their queue is empty, and everything (IndexedDB
and the scanner's caches) is deleted on sign-out.

**Online first.** Each scan tries the API with a 5 s timeout; on network errors, timeouts or 5xx
responses the device decides with the bundle and queues valid check-ins. The queue syncs every
10 s and on the browser's `online` event, in batches of up to 500.

**Sync and conflicts.** Each item runs in its own transaction. Retries are recognized by client id
(stored check-in or recorded duplicate). On conflict the earliest `scanned_at` wins: if the
incoming scan is earlier it replaces the stored check-in, whose details are recorded as a
`duplicate_offline` attempt; otherwise the incoming one is the duplicate. The stored row is locked
(`FOR UPDATE`) so concurrent syncs are serialized. Items the server no longer accepts (e.g. the
ticket was revoked meanwhile) are reported as `rejected` and not counted.

**Device clocks.** `scanned_at` later than server time + 5 min is clamped to the server time, and
times outside the check-in window to its edges; such rows are flagged `clock_adjusted`.

**Service worker: hand-written, no Serwist.** The Phase 0 plan named `@serwist/next`, whose Next.js
integration depends on webpack while this project builds with Turbopack. The scanner only needs a
small worker (`apps/web/public/sw.js`, about 100 lines): cache-first for `/_next/static`, the QR
decoder WASM, icons and the manifest; network-first with cache fallback for scanner pages; API
responses are never cached. The decoder WASM is precached at install, and the scanner page sends
the URLs it already loaded so they are available offline immediately.

**Dashboard.** Stats list offline duplicates (who, kept time, duplicate time, staff member,
device), as ADR-0005 requires.

## Consequences

- A phone that opened the scanner once while online keeps working through network loss, including
  a full page reload.
- The worker is ours to maintain; it is covered by an e2e test that reloads the scanner offline.
- ADR-0005 is finalized by this ADR.
