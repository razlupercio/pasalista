// SPDX-License-Identifier: AGPL-3.0-or-later
import { generateSigningKeyPair } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { decryptSecret, encryptSecret, type KeyEncryptionKey } from "../crypto/key-encryption.ts";
import type { Executor } from "./context.ts";

const { eventSigningKeys } = schema;

/** AAD binding a ciphertext to its row (ADR-0002). */
function keyContext(eventId: string, version: number): string {
  return `pasalista:event-key:${eventId}:${version}`;
}

export async function createSigningKey(
  db: Executor,
  kek: KeyEncryptionKey,
  eventId: string,
  version: number,
): Promise<void> {
  const { secretKey, publicKey } = generateSigningKeyPair();
  try {
    await db.insert(eventSigningKeys).values({
      eventId,
      version,
      publicKey,
      privateKeyCiphertext: encryptSecret(kek, secretKey, keyContext(eventId, version)),
      kekId: kek.id,
      status: "active",
    });
  } finally {
    secretKey.fill(0);
  }
}

/** Retires the active key and creates the next version. Call inside a transaction holding the event lock. */
export async function rotateSigningKey(
  db: Executor,
  kek: KeyEncryptionKey,
  eventId: string,
): Promise<number> {
  const [latest] = await db
    .select({ version: eventSigningKeys.version })
    .from(eventSigningKeys)
    .where(eq(eventSigningKeys.eventId, eventId))
    .orderBy(desc(eventSigningKeys.version))
    .limit(1);
  await db
    .update(eventSigningKeys)
    .set({ status: "retired" })
    .where(and(eq(eventSigningKeys.eventId, eventId), eq(eventSigningKeys.status, "active")));
  const version = (latest?.version ?? 0) + 1;
  await createSigningKey(db, kek, eventId, version);
  return version;
}

/** Decrypts the secret key for one version. The caller must zero it after use. */
export async function loadSecretKey(
  db: Executor,
  kek: KeyEncryptionKey,
  eventId: string,
  version: number,
): Promise<Uint8Array> {
  const [row] = await db
    .select({ ciphertext: eventSigningKeys.privateKeyCiphertext, status: eventSigningKeys.status })
    .from(eventSigningKeys)
    .where(and(eq(eventSigningKeys.eventId, eventId), eq(eventSigningKeys.version, version)));
  if (!row || row.status === "revoked") throw new Error("Signing key unavailable");
  return decryptSecret(kek, row.ciphertext, keyContext(eventId, version));
}

export async function activeKeyVersion(db: Executor, eventId: string): Promise<number> {
  const [row] = await db
    .select({ version: eventSigningKeys.version })
    .from(eventSigningKeys)
    .where(and(eq(eventSigningKeys.eventId, eventId), eq(eventSigningKeys.status, "active")));
  if (!row) throw new Error("Event has no active signing key");
  return row.version;
}

/** Public keys that still verify (active and retired), by version. Served to scanners in Phase 4. */
export async function verificationKeys(
  db: Executor,
  eventIds: string[],
): Promise<Map<string, Map<number, Uint8Array>>> {
  const rows =
    eventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventSigningKeys.eventId,
            version: eventSigningKeys.version,
            publicKey: eventSigningKeys.publicKey,
          })
          .from(eventSigningKeys)
          .where(
            and(
              inArray(eventSigningKeys.eventId, eventIds),
              ne(eventSigningKeys.status, "revoked"),
            ),
          );
  const out = new Map<string, Map<number, Uint8Array>>();
  for (const row of rows) {
    const keys = out.get(row.eventId) ?? new Map<number, Uint8Array>();
    keys.set(row.version, row.publicKey);
    out.set(row.eventId, keys);
  }
  return out;
}
