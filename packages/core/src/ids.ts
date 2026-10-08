// SPDX-License-Identifier: AGPL-3.0-or-later

/** Fills the array with cryptographically secure random bytes. Injected to keep core platform-agnostic. */
export type RandomSource = (bytes: Uint8Array) => Uint8Array;

interface WebCryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/** Uses the standard Web Crypto API (Node >= 19, browsers, React Native with a polyfill). */
export const defaultRandomSource: RandomSource = (bytes) => {
  const webCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (!webCrypto) {
    throw new Error("No secure random source available: provide a RandomSource");
  }
  return webCrypto.getRandomValues(bytes);
};

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function toUuidString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i] as number];
  }
  return out;
}

/**
 * RFC 9562 UUIDv7: 48-bit Unix timestamp in milliseconds followed by 74 random bits.
 * Time-ordered (good index locality) but not enumerable.
 */
export function uuidv7(now: number = Date.now(), random: RandomSource = defaultRandomSource): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError("Timestamp out of range for UUIDv7");
  }
  const bytes = random(new Uint8Array(16));
  // Big-endian 48-bit timestamp; split because bitwise ops are 32-bit in JS.
  const high = Math.floor(now / 0x1_0000_0000);
  const low = now % 0x1_0000_0000;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 9562 variant
  return toUuidString(bytes);
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
