// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./encoding.ts";
import { uuidv7 } from "./ids.ts";
import {
  bytesEqual,
  generateSigningKeyPair,
  generateTicketNonce,
  parseTicketToken,
  signTicketToken,
  TICKET_TOKEN_PREFIX,
  verifyTicketToken,
  type TicketTokenPayload,
} from "./qr-token.ts";

const keys = generateSigningKeyPair();
const otherKeys = generateSigningKeyPair();

function payload(overrides: Partial<TicketTokenPayload> = {}): TicketTokenPayload {
  return {
    eventId: uuidv7(),
    attendeeId: uuidv7(),
    keyVersion: 1,
    nonce: generateTicketNonce(),
    ...overrides,
  };
}

function verify(token: string, eventId: string, publicKeys = new Map([[1, keys.publicKey]])) {
  return verifyTicketToken(token, { eventId, publicKeys });
}

/** Rebuilds a token after mutating its raw bytes. */
function mutate(token: string, change: (raw: Uint8Array) => void): string {
  const raw = fromBase64Url(token.slice(TICKET_TOKEN_PREFIX.length))!;
  change(raw);
  return TICKET_TOKEN_PREFIX + toBase64Url(raw);
}

describe("ticket token format", () => {
  it("is compact enough for a QR code at error correction level M", () => {
    const token = signTicketToken(payload(), keys.secretKey);
    expect(token.startsWith("PL1.")).toBe(true);
    expect(token).toHaveLength(152);
    expect(token).toMatch(/^PL1\.[A-Za-z0-9_-]+$/);
  });

  it("round-trips every payload field", () => {
    const p = payload({ keyVersion: 513 });
    const parsed = parseTicketToken(signTicketToken(p, keys.secretKey))!;
    expect(parsed.eventId).toBe(p.eventId);
    expect(parsed.attendeeId).toBe(p.attendeeId);
    expect(parsed.keyVersion).toBe(513);
    expect(bytesEqual(parsed.nonce, p.nonce)).toBe(true);
  });

  it("is deterministic for the same ticket and key", () => {
    const p = payload();
    expect(signTicketToken(p, keys.secretKey)).toBe(signTicketToken(p, keys.secretKey));
  });

  it("rejects invalid payload values when signing", () => {
    expect(() => signTicketToken(payload({ keyVersion: 0 }), keys.secretKey)).toThrow(RangeError);
    expect(() => signTicketToken(payload({ keyVersion: 70_000 }), keys.secretKey)).toThrow(
      RangeError,
    );
    expect(() => signTicketToken(payload({ nonce: new Uint8Array(8) }), keys.secretKey)).toThrow(
      RangeError,
    );
    expect(() => signTicketToken(payload({ eventId: "42" }), keys.secretKey)).toThrow(TypeError);
  });
});

describe("verifyTicketToken", () => {
  it("accepts a genuine token for the right event", () => {
    const p = payload();
    const result = verify(signTicketToken(p, keys.secretKey), p.eventId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.attendeeId).toBe(p.attendeeId);
  });

  it("reports a token for another event as wrong_event", () => {
    const token = signTicketToken(payload(), keys.secretKey);
    expect(verify(token, uuidv7())).toEqual({ ok: false, reason: "wrong_event" });
  });

  it("rejects tokens signed with another key", () => {
    const p = payload();
    expect(verify(signTicketToken(p, otherKeys.secretKey), p.eventId)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects unknown or revoked key versions", () => {
    const p = payload({ keyVersion: 2 });
    expect(verify(signTicketToken(p, keys.secretKey), p.eventId)).toEqual({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("verifies with the matching version when several keys exist (rotation)", () => {
    const p = payload({ keyVersion: 2 });
    const token = signTicketToken(p, otherKeys.secretKey);
    const publicKeys = new Map([
      [1, keys.publicKey],
      [2, otherKeys.publicKey],
    ]);
    expect(verify(token, p.eventId, publicKeys).ok).toBe(true);
  });

  it.each([
    ["the attendee id", 20],
    ["the key version", 34],
    ["the nonce", 40],
    ["the signature", 100],
  ])("detects tampering with %s", (_, offset) => {
    const p = payload();
    const token = mutate(signTicketToken(p, keys.secretKey), (raw) => {
      raw[offset] = (raw[offset] as number) ^ 0x01;
    });
    const result = verify(
      token,
      p.eventId,
      new Map([
        [1, keys.publicKey],
        [257, keys.publicKey],
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ["empty string", ""],
    ["missing prefix", "abc"],
    ["wrong prefix", "PL2.AAAA"],
    ["not base64url", "PL1.!!!!"],
    ["padding", "PL1.AAAA=="],
    ["truncated", "PL1." + "A".repeat(100)],
  ])("treats %s as malformed", (_, token) => {
    expect(verify(token, uuidv7())).toEqual({ ok: false, reason: "malformed" });
  });

  it("treats an unknown format version as malformed", () => {
    const p = payload();
    const token = mutate(signTicketToken(p, keys.secretKey), (raw) => {
      raw[0] = 2;
    });
    expect(verify(token, p.eventId)).toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts the event id in any letter case", () => {
    const p = payload();
    expect(verify(signTicketToken(p, keys.secretKey), p.eventId.toUpperCase()).ok).toBe(true);
  });
});

describe("bytesEqual", () => {
  it("compares length and content", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
