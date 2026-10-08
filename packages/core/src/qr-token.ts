// SPDX-License-Identifier: AGPL-3.0-or-later
// QR ticket tokens, format v1 (ADR-0002). Shared by the API (signing, online verification)
// and the scanner (offline verification), so it must stay platform-agnostic.
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  bytesToUuid,
  concatBytes,
  fromBase64Url,
  toBase64Url,
  ascii,
  uuidToBytes,
} from "./encoding.ts";
import { defaultRandomSource, type RandomSource } from "./ids.ts";

export const TICKET_TOKEN_PREFIX = "PL1.";
export const TICKET_TOKEN_FORMAT_VERSION = 1;
export const TICKET_NONCE_LENGTH = 12;

const PAYLOAD_LENGTH = 1 + 16 + 16 + 2 + TICKET_NONCE_LENGTH; // 47 bytes
const SIGNATURE_LENGTH = 64;
const DOMAIN = ascii("pasalista:qr:v1");

export interface TicketTokenPayload {
  eventId: string;
  attendeeId: string;
  keyVersion: number;
  nonce: Uint8Array;
}

export interface SigningKeyPair {
  /** 32-byte Ed25519 seed. Server-side only; never leaves the API. */
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateSigningKeyPair(random: RandomSource = defaultRandomSource): SigningKeyPair {
  const secretKey = random(new Uint8Array(32));
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function publicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

export function generateTicketNonce(random: RandomSource = defaultRandomSource): Uint8Array {
  return random(new Uint8Array(TICKET_NONCE_LENGTH));
}

function encodePayload(payload: TicketTokenPayload): Uint8Array {
  if (
    !Number.isInteger(payload.keyVersion) ||
    payload.keyVersion < 1 ||
    payload.keyVersion > 0xffff
  ) {
    throw new RangeError("keyVersion must be an integer between 1 and 65535");
  }
  if (payload.nonce.length !== TICKET_NONCE_LENGTH) {
    throw new RangeError(`nonce must be ${TICKET_NONCE_LENGTH} bytes`);
  }
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = TICKET_TOKEN_FORMAT_VERSION;
  bytes.set(uuidToBytes(payload.eventId), 1);
  bytes.set(uuidToBytes(payload.attendeeId), 17);
  bytes[33] = payload.keyVersion >> 8;
  bytes[34] = payload.keyVersion & 0xff;
  bytes.set(payload.nonce, 35);
  return bytes;
}

/** Signs a ticket. Ed25519 is deterministic: the same ticket always yields the same token. */
export function signTicketToken(payload: TicketTokenPayload, secretKey: Uint8Array): string {
  const bytes = encodePayload(payload);
  const signature = ed25519.sign(concatBytes(DOMAIN, bytes), secretKey);
  return TICKET_TOKEN_PREFIX + toBase64Url(concatBytes(bytes, signature));
}

export type ParsedTicketToken = TicketTokenPayload & {
  signedBytes: Uint8Array;
  signature: Uint8Array;
};

/** Parses without verifying. Returns null for anything that is not a well-formed v1 token. */
export function parseTicketToken(token: string): ParsedTicketToken | null {
  if (typeof token !== "string" || !token.startsWith(TICKET_TOKEN_PREFIX)) return null;
  const raw = fromBase64Url(token.slice(TICKET_TOKEN_PREFIX.length));
  if (!raw || raw.length !== PAYLOAD_LENGTH + SIGNATURE_LENGTH) return null;
  if (raw[0] !== TICKET_TOKEN_FORMAT_VERSION) return null;
  const keyVersion = ((raw[33] as number) << 8) | (raw[34] as number);
  if (keyVersion === 0) return null;
  return {
    eventId: bytesToUuid(raw.slice(1, 17)),
    attendeeId: bytesToUuid(raw.slice(17, 33)),
    keyVersion,
    nonce: raw.slice(35, PAYLOAD_LENGTH),
    signedBytes: raw.slice(0, PAYLOAD_LENGTH),
    signature: raw.slice(PAYLOAD_LENGTH),
  };
}

export type TicketTokenCheck =
  | { ok: true; payload: TicketTokenPayload }
  | { ok: false; reason: "malformed" | "wrong_event" | "unknown_key" | "bad_signature" };

/**
 * Steps 1 to 3 of the verification order in ADR-0002. Ticket status (nonce match, revocation)
 * and check-in state are checked by the caller against its data (database or offline bundle).
 */
export function verifyTicketToken(
  token: string,
  options: { eventId: string; publicKeys: ReadonlyMap<number, Uint8Array> },
): TicketTokenCheck {
  const parsed = parseTicketToken(token);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.eventId !== options.eventId.toLowerCase()) return { ok: false, reason: "wrong_event" };
  const publicKey = options.publicKeys.get(parsed.keyVersion);
  if (!publicKey) return { ok: false, reason: "unknown_key" };
  let valid: boolean;
  try {
    valid = ed25519.verify(parsed.signature, concatBytes(DOMAIN, parsed.signedBytes), publicKey);
  } catch {
    valid = false; // malformed public key or signature encoding
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  const { eventId, attendeeId, keyVersion, nonce } = parsed;
  return { ok: true, payload: { eventId, attendeeId, keyVersion, nonce } };
}

/** Constant-time comparison for nonces and other short secrets. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}
