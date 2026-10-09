// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

// Scanner data kept on the device for offline use (ADR-0005): the event bundle, the queue of
// check-ins waiting to sync and the attendees this device already checked in.
import type { OfflineBundle, SyncItem } from "@pasalista/core";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface QueuedCheckIn {
  eventId: string;
  item: SyncItem;
  attendeeId: string;
}

interface ScannerDB extends DBSchema {
  bundles: { key: string; value: { eventId: string; bundle: OfflineBundle; savedAt: string } };
  queue: { key: string; value: QueuedCheckIn; indexes: { byEvent: string } };
  checkedIn: { key: [string, string]; value: { eventId: string; attendeeId: string } };
}

const DB_NAME = "pasalista-scanner";
let dbPromise: Promise<IDBPDatabase<ScannerDB>> | null = null;

function db(): Promise<IDBPDatabase<ScannerDB>> {
  dbPromise ??= openDB<ScannerDB>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore("bundles", { keyPath: "eventId" });
      const queue = database.createObjectStore("queue", { keyPath: "item.clientCheckInId" });
      queue.createIndex("byEvent", "eventId");
      database.createObjectStore("checkedIn", { keyPath: ["eventId", "attendeeId"] });
    },
  });
  return dbPromise;
}

export async function saveBundle(bundle: OfflineBundle): Promise<void> {
  await (
    await db()
  ).put("bundles", { eventId: bundle.event.id, bundle, savedAt: new Date().toISOString() });
}

export async function loadBundle(eventId: string): Promise<OfflineBundle | null> {
  return (await (await db()).get("bundles", eventId))?.bundle ?? null;
}

export async function enqueue(entry: QueuedCheckIn): Promise<void> {
  const database = await db();
  const tx = database.transaction(["queue", "checkedIn"], "readwrite");
  await tx.objectStore("queue").put(entry);
  await tx.objectStore("checkedIn").put({ eventId: entry.eventId, attendeeId: entry.attendeeId });
  await tx.done;
}

export async function queued(eventId: string): Promise<QueuedCheckIn[]> {
  return (await db()).getAllFromIndex("queue", "byEvent", eventId);
}

export async function removeQueued(clientCheckInIds: string[]): Promise<void> {
  const tx = (await db()).transaction("queue", "readwrite");
  await Promise.all(clientCheckInIds.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function markCheckedIn(eventId: string, attendeeId: string): Promise<void> {
  await (await db()).put("checkedIn", { eventId, attendeeId });
}

export async function checkedInHere(eventId: string): Promise<Set<string>> {
  const rows = await (
    await db()
  ).getAll("checkedIn", IDBKeyRange.bound([eventId, ""], [eventId, "\uFFFF"]));
  return new Set(rows.map((row) => row.attendeeId));
}

/** Deletes everything stored for one event (closed event or access removed). */
export async function forgetEvent(eventId: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["bundles", "queue", "checkedIn"], "readwrite");
  await tx.objectStore("bundles").delete(eventId);
  for (const key of await tx.objectStore("queue").index("byEvent").getAllKeys(eventId)) {
    await tx.objectStore("queue").delete(key);
  }
  await tx.objectStore("checkedIn").delete(IDBKeyRange.bound([eventId, ""], [eventId, "\uFFFF"]));
  await tx.done;
}

/** Removes bundles whose check-in window ended more than a day ago (unsynced queues are kept). */
export async function purgeExpired(now = Date.now()): Promise<void> {
  const database = await db();
  for (const { eventId, bundle } of await database.getAll("bundles")) {
    if (
      Date.parse(bundle.event.closesAt) + 24 * 60 * 60 * 1000 < now &&
      (await queued(eventId)).length === 0
    ) {
      await forgetEvent(eventId);
    }
  }
}

/** Called on sign-out: no scanner data stays on a shared device. */
export async function clearOfflineData(): Promise<void> {
  try {
    dbPromise = null;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    if ("caches" in globalThis) {
      for (const key of await caches.keys()) {
        if (key.startsWith("pasalista-")) await caches.delete(key);
      }
    }
  } catch {
    // Storage may be unavailable (private mode); nothing to clear then.
  }
}
