# ADR-0002: QR token format and key management

- Status: Proposed
- Date: 2026-10-08

## Context

The QR must be verifiable offline by a scanner device without giving that device any secret,
must not contain predictable identifiers, and must support revocation and key rotation. The
verification code must run unchanged in Node (API), browsers (PWA) and React Native (future).

## Decision

**Keys.** Each event has Ed25519 key pairs in `event_signing_keys` with an integer `version`;
exactly one is `active`. The private key is encrypted at rest with AES-256-GCM using a master
key (KEK) from the environment (`QR_KEY_ENCRYPTION_KEY`; `kek_id` is stored to allow KEK
rotation). Private keys never leave the API process and are never logged.

**Payload (format v1)**: fixed-length binary, 47 bytes.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | format version (`0x01`) |
| 1 | 16 | `eventId` (UUID bytes) |
| 17 | 16 | `attendeeId` (UUID bytes) |
| 33 | 2 | `keyVersion` (uint16, big-endian) |
| 35 | 12 | `nonce` (random, per ticket issuance) |

**Signature.** Ed25519 over the ASCII prefix `pasalista:qr:v1` followed by the payload
(domain separation), 64 bytes.

**Encoding.** `PL1.` + base64url(payload ‖ signature) without padding: about 152
characters, which fits a QR code at error-correction level M with room to spare. The prefix
lets the scanner reject foreign QR codes immediately and leaves room for future formats.

**Library.** `@noble/curves` (pure TypeScript, audited, no dependencies) inside
`packages/core`. Random bytes come from an injected `getRandomValues`, so core uses no
platform APIs. WebCrypto Ed25519 was rejected because React Native support is not guaranteed.

**Verification order** (same online and offline):

1. Prefix and length are valid, format version is known (`INVALID`).
2. `eventId` matches the scanner's event (`WRONG_EVENT`).
3. Key version is known and not revoked, signature is valid (`INVALID`).
4. Nonce equals the attendee's active ticket and the ticket is not revoked (`REVOKED`).
5. Check-in state (`VALID` / `ALREADY_USED`).

**Revocation and rotation.**

- Reissue a ticket: the old `tickets` row becomes `superseded` and a new one gets a fresh
  nonce; the old QR fails step 4.
- Revoke a ticket: it becomes `revoked` and is included in the offline revocation list.
- Rotate an event key: the new version becomes `active`, the previous one `retired` (still
  verifies). Revoke a key: every token of that version is rejected and tickets are reissued.

## Consequences

- Scanners hold only public keys: a compromised scanner device cannot forge tickets.
- IDs in the QR are UUIDs (UUIDv7 has 74 random bits); authenticity comes from the
  signature, not from ID secrecy.
- The QR is a bearer credential: screenshots work and can be shared. Single-entry check-in
  limits the damage. The ticket page is served with `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store`.
- Full tokens are never logged; logs may include a short hash prefix for correlation.

## Alternatives considered

- **HMAC tokens:** offline verification would require the secret on every scanner.
- **JWT / PASETO:** larger payloads (denser QR, slower scans) with no benefit here.
- **Random opaque ID only:** cannot be verified offline without the full attendee list.
