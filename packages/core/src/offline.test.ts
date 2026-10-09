// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { toBase64Url } from "./encoding.ts";
import { uuidv7 } from "./ids.ts";
import {
  displayName,
  evaluateOfflineManual,
  evaluateOfflineScan,
  type OfflineBundle,
} from "./offline.ts";
import { generateSigningKeyPair, generateTicketNonce, signTicketToken } from "./qr-token.ts";

const keys = generateSigningKeyPair();
const eventId = uuidv7();
const now = new Date("2030-01-15T19:30:00Z");

function bundleWith(attendees: OfflineBundle["attendees"]): OfflineBundle {
  return {
    event: {
      id: eventId,
      name: "Concierto",
      timezone: "America/Mexico_City",
      opensAt: "2030-01-15T13:00:00.000Z",
      closesAt: "2030-01-15T23:00:00.000Z",
    },
    keys: [{ version: 1, publicKey: toBase64Url(keys.publicKey) }],
    attendees,
    generatedAt: "2030-01-15T18:00:00.000Z",
  };
}

function ticket(overrides: { checkedInAt?: string | null; nonce?: Uint8Array | null } = {}) {
  const id = uuidv7();
  const nonce = generateTicketNonce();
  const token = signTicketToken({ eventId, attendeeId: id, keyVersion: 1, nonce }, keys.secretKey);
  const stored = overrides.nonce === undefined ? nonce : overrides.nonce;
  return {
    token,
    attendee: {
      id,
      displayName: "Ana L.",
      nonce: stored ? toBase64Url(stored) : null,
      manualAllowed: false,
      checkedInAt: overrides.checkedInAt ?? null,
    },
  };
}

describe("displayName", () => {
  it.each([
    ["Ana María López", "Ana L."],
    ["  sam   doe ", "sam D."],
    ["Cher", "Cher"],
    ["", ""],
  ])("turns %j into %j", (full, short) => {
    expect(displayName(full)).toBe(short);
  });
});

describe("evaluateOfflineScan", () => {
  it("accepts a valid ticket once, then reports it as already used", () => {
    const { token, attendee } = ticket();
    const bundle = bundleWith([attendee]);
    expect(evaluateOfflineScan(bundle, token, new Set(), now)).toEqual({
      outcome: "valid",
      attendee,
    });
    expect(evaluateOfflineScan(bundle, token, new Set([attendee.id]), now).outcome).toBe(
      "already_used",
    );
  });

  it("knows attendees checked in before the bundle was downloaded", () => {
    const { token, attendee } = ticket({ checkedInAt: "2030-01-15T19:00:00.000Z" });
    expect(evaluateOfflineScan(bundleWith([attendee]), token, new Set(), now).outcome).toBe(
      "already_used",
    );
  });

  it("rejects superseded or revoked tickets (nonce mismatch or none)", () => {
    const replaced = ticket({ nonce: generateTicketNonce() });
    const revoked = ticket({ nonce: null });
    const bundle = bundleWith([replaced.attendee, revoked.attendee]);
    expect(evaluateOfflineScan(bundle, replaced.token, new Set(), now).outcome).toBe("revoked");
    expect(evaluateOfflineScan(bundle, revoked.token, new Set(), now).outcome).toBe("revoked");
  });

  it("rejects forged tokens, other events and scans outside the window", () => {
    const { token, attendee } = ticket();
    const bundle = bundleWith([attendee]);
    const otherKeys = generateSigningKeyPair();
    const forged = signTicketToken(
      { eventId, attendeeId: attendee.id, keyVersion: 1, nonce: generateTicketNonce() },
      otherKeys.secretKey,
    );
    expect(evaluateOfflineScan(bundle, forged, new Set(), now).outcome).toBe("invalid");
    expect(
      evaluateOfflineScan(
        { ...bundle, event: { ...bundle.event, id: uuidv7() } },
        token,
        new Set(),
        now,
      ).outcome,
    ).toBe("wrong_event");
    expect(
      evaluateOfflineScan(bundle, token, new Set(), new Date("2030-01-16T00:00:00Z")).outcome,
    ).toBe("outside_window");
  });
});

describe("evaluateOfflineManual", () => {
  it("allows pending guests and blocks revoked ones", () => {
    const pending = { ...ticket({ nonce: null }).attendee, manualAllowed: true };
    const revoked = ticket({ nonce: null }).attendee;
    const bundle = bundleWith([pending, revoked]);
    expect(evaluateOfflineManual(bundle, pending.id, new Set(), now).outcome).toBe("valid");
    expect(evaluateOfflineManual(bundle, revoked.id, new Set(), now).outcome).toBe("revoked");
    expect(evaluateOfflineManual(bundle, uuidv7(), new Set(), now).outcome).toBe("invalid");
  });
});
