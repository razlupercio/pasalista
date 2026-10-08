// SPDX-License-Identifier: AGPL-3.0-or-later
// Envelope encryption for per-event signing keys (ADR-0002): AES-256-GCM with a master key
// (KEK) from the environment. Server-only, so it uses Node's crypto module.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface KeyEncryptionKey {
  id: string;
  key: Buffer;
}

export function loadKek(base64Url: string, id: string): KeyEncryptionKey {
  const key = Buffer.from(base64Url, "base64url");
  if (key.length !== 32) throw new Error("QR_KEY_ENCRYPTION_KEY must decode to 32 bytes");
  return { id, key };
}

/**
 * Encrypts `plaintext`. `context` (e.g. event id and key version) is bound as additional
 * authenticated data, so a ciphertext copied to another row fails to decrypt.
 * Output layout: iv (12) | ciphertext | auth tag (16).
 */
export function encryptSecret(
  kek: KeyEncryptionKey,
  plaintext: Uint8Array,
  context: string,
): Uint8Array {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", kek.key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([iv, ciphertext, cipher.getAuthTag()]));
}

export function decryptSecret(
  kek: KeyEncryptionKey,
  sealed: Uint8Array,
  context: string,
): Uint8Array {
  if (sealed.length < IV_LENGTH + TAG_LENGTH) throw new Error("Ciphertext too short");
  const data = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", kek.key, data.subarray(0, IV_LENGTH));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(data.subarray(data.length - TAG_LENGTH));
  const plaintext = Buffer.concat([
    decipher.update(data.subarray(IV_LENGTH, data.length - TAG_LENGTH)),
    decipher.final(),
  ]);
  return new Uint8Array(plaintext);
}

/** Random URL-safe secret (256 bits) and its SHA-256 hash for storage. */
export function newAccessToken(): { token: string; hash: Uint8Array } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token, "utf8").digest());
}
