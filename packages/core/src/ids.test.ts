// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { UUID_REGEX, uuidv7, type RandomSource } from "./ids.ts";

const zeros: RandomSource = (bytes) => bytes.fill(0);
const ones: RandomSource = (bytes) => bytes.fill(0xff);

describe("uuidv7", () => {
  it("produces a canonical RFC 9562 version 7 UUID", () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_REGEX);
    expect(id[14]).toBe("7");
  });

  it("encodes the timestamp big-endian in the first 48 bits", () => {
    const ts = 0x0189_7a2b_3c4d;
    expect(uuidv7(ts, zeros)).toBe("01897a2b-3c4d-7000-8000-000000000000");
  });

  it("sets version and variant bits even when random bytes are all ones", () => {
    expect(uuidv7(0, ones)).toBe("00000000-0000-7fff-bfff-ffffffffffff");
  });

  it("is ordered by creation time", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });

  it("rejects timestamps outside the 48-bit range", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
  });
});
