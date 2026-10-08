// SPDX-License-Identifier: AGPL-3.0-or-later
// Byte helpers without Node's Buffer or DOM APIs, so they run in Node, browsers and React Native.

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map([...BASE64URL].map((char, index) => [char, index]));

/** RFC 4648 §5 base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64URL[a >> 2];
    out += BASE64URL[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += BASE64URL[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += BASE64URL[c & 0x3f];
  }
  return out;
}

/** Strict decoder: rejects padding, foreign characters and non-canonical trailing bits. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const values: number[] = [];
  for (const char of text) {
    const value = BASE64URL_LOOKUP.get(char);
    if (value === undefined) return null;
    values.push(value);
  }
  const out = new Uint8Array(Math.floor((values.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const value of values) {
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero, otherwise two strings would decode to the same bytes.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidToBytes(uuid: string): Uint8Array {
  const normalized = uuid.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError("Invalid UUID");
  const hex = normalized.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new TypeError("A UUID has 16 bytes");
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** ASCII-only encoder (TextEncoder is not part of the ES library core targets). */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) throw new RangeError("Non-ASCII character");
    out[i] = code;
  }
  return out;
}
