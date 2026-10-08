// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ascii, bytesToUuid, fromBase64Url, toBase64Url, uuidToBytes } from "./encoding.ts";
import { uuidv7 } from "./ids.ts";

describe("base64url", () => {
  it.each([
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
  ])("encodes %j as %j (RFC 4648 vectors)", (input, expected) => {
    expect(toBase64Url(ascii(input))).toBe(expected);
    expect(fromBase64Url(expected)).toEqual(ascii(input));
  });

  it("uses the URL-safe alphabet", () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("round-trips random bytes of every length", () => {
    for (let length = 0; length < 70; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("rejects padding, foreign characters, impossible lengths and non-canonical input", () => {
    expect(fromBase64Url("Zg==")).toBeNull();
    expect(fromBase64Url("Zm9v+/")).toBeNull();
    expect(fromBase64Url("Z")).toBeNull();
    expect(fromBase64Url("Zh")).toBeNull(); // trailing bits set
  });
});

describe("UUID bytes", () => {
  it("round-trips", () => {
    const id = uuidv7();
    expect(bytesToUuid(uuidToBytes(id))).toBe(id);
  });

  it("rejects malformed UUIDs", () => {
    expect(() => uuidToBytes("not-a-uuid")).toThrow(TypeError);
    expect(() => bytesToUuid(new Uint8Array(15))).toThrow(TypeError);
  });
});

describe("ascii", () => {
  it("rejects non-ASCII text", () => {
    expect(() => ascii("ñ")).toThrow(RangeError);
  });
});
