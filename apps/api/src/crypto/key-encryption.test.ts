// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashAccessToken,
  loadKek,
  newAccessToken,
} from "./key-encryption.ts";

const kek = loadKek(randomBytes(32).toString("base64url"), "k1");

describe("key encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const secret = randomBytes(32);
    const sealed = encryptSecret(kek, secret, "event:1");
    expect(Buffer.from(sealed).includes(secret)).toBe(false);
    expect(decryptSecret(kek, sealed, "event:1")).toEqual(new Uint8Array(secret));
  });

  it("uses a fresh IV every time", () => {
    const secret = randomBytes(32);
    expect(encryptSecret(kek, secret, "c")).not.toEqual(encryptSecret(kek, secret, "c"));
  });

  it("fails with another KEK, another context or tampered data", () => {
    const sealed = encryptSecret(kek, randomBytes(32), "event:1");
    const otherKek = loadKek(randomBytes(32).toString("base64url"), "k2");
    expect(() => decryptSecret(otherKek, sealed, "event:1")).toThrow();
    expect(() => decryptSecret(kek, sealed, "event:2")).toThrow();
    const tampered = new Uint8Array(sealed);
    tampered[20] = (tampered[20] as number) ^ 1;
    expect(() => decryptSecret(kek, tampered, "event:1")).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => loadKek(randomBytes(16).toString("base64url"), "k")).toThrow();
  });
});

describe("access tokens", () => {
  it("are 256-bit URL-safe secrets stored only as hashes", () => {
    const { token, hash } = newAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toEqual(hashAccessToken(token));
    expect(newAccessToken().token).not.toBe(token);
  });
});
