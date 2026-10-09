// SPDX-License-Identifier: AGPL-3.0-or-later
// Offline scanning (ADR-0005): bundle download and sync with earliest-scan-wins conflicts.
import {
  checkInWindow,
  displayName,
  toBase64Url,
  type OfflineBundle,
  type SyncItem,
  type SyncRequest,
  type SyncResult,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq, ne } from "drizzle-orm";
import { findScannableEvent } from "./access.ts";
import { counts, validateCredential } from "./checkins.ts";
import { nowOf, type ServiceDeps } from "./context.ts";

const { attendees, checkIns, checkInAttempts, eventSigningKeys, tickets } = schema;

type EventRow = typeof schema.events.$inferSelect;

/** Device clocks ahead by more than this are considered wrong and clamped. */
const MAX_CLOCK_AHEAD_MS = 5 * 60 * 1000;

export async function offlineBundle(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<OfflineBundle> {
  const { event } = await findScannableEvent(deps.db, userId, eventId);
  const window = checkInWindow(event);
  const [keys, rows] = await Promise.all([
    deps.db
      .select({ version: eventSigningKeys.version, publicKey: eventSigningKeys.publicKey })
      .from(eventSigningKeys)
      .where(and(eq(eventSigningKeys.eventId, event.id), ne(eventSigningKeys.status, "revoked"))),
    deps.db
      .select({
        id: attendees.id,
        name: attendees.name,
        invitationPending: attendees.invitationPending,
        nonce: tickets.nonce,
        checkedInAt: checkIns.scannedAt,
      })
      .from(attendees)
      .leftJoin(tickets, and(eq(tickets.attendeeId, attendees.id), eq(tickets.status, "active")))
      .leftJoin(checkIns, eq(checkIns.attendeeId, attendees.id))
      .where(and(eq(attendees.eventId, event.id), eq(attendees.status, "active"))),
  ]);
  return {
    event: {
      id: event.id,
      name: event.name,
      timezone: event.timezone,
      opensAt: window.opensAt.toISOString(),
      closesAt: window.closesAt.toISOString(),
    },
    keys: keys.map((k) => ({ version: k.version, publicKey: toBase64Url(k.publicKey) })),
    // Minimal data on the device (maintainer decision): id, short name, active nonce, state.
    attendees: rows.map((row) => ({
      id: row.id,
      displayName: displayName(row.name),
      nonce: row.nonce ? toBase64Url(row.nonce) : null,
      manualAllowed: row.invitationPending,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
    })),
    generatedAt: nowOf(deps).toISOString(),
  };
}

/**
 * The device clock decides who was first, but it cannot be trusted blindly: times in the future
 * are clamped to the server time, and times outside the check-in window to its edges.
 */
function clampScanTime(
  event: EventRow,
  scannedAt: Date,
  receivedAt: Date,
): { at: Date; adjusted: boolean } {
  const { opensAt, closesAt } = checkInWindow(event);
  let at = scannedAt;
  if (at.getTime() > receivedAt.getTime() + MAX_CLOCK_AHEAD_MS) at = receivedAt;
  if (at < opensAt) at = opensAt;
  if (at > closesAt) at = closesAt;
  return { at, adjusted: at.getTime() !== scannedAt.getTime() };
}

type ItemResult = SyncResult["results"][number];

async function syncItem(
  deps: ServiceDeps,
  user: { id: string },
  event: EventRow,
  deviceId: string,
  item: SyncItem,
): Promise<ItemResult> {
  const receivedAt = nowOf(deps);
  const result = (
    status: ItemResult["status"],
    outcome: string | null,
    checkedInAt: Date | null,
  ): ItemResult => ({
    clientCheckInId: item.clientCheckInId,
    status,
    outcome,
    checkedInAt: checkedInAt?.toISOString() ?? null,
  });

  return deps.db.transaction(async (tx) => {
    // Idempotent retries: this scan was already stored as the check-in or as a duplicate.
    const [stored] = await tx
      .select()
      .from(checkIns)
      .where(eq(checkIns.clientCheckInId, item.clientCheckInId));
    if (stored) return result("accepted", null, stored.scannedAt);
    const [reported] = await tx
      .select({ id: checkInAttempts.id, attendeeId: checkInAttempts.attendeeId })
      .from(checkInAttempts)
      .where(
        and(
          eq(checkInAttempts.clientCheckInId, item.clientCheckInId),
          eq(checkInAttempts.outcome, "duplicate_offline"),
        ),
      );
    if (reported) {
      const [kept] = reported.attendeeId
        ? await tx.select().from(checkIns).where(eq(checkIns.attendeeId, reported.attendeeId))
        : [];
      return result("duplicate", null, kept?.scannedAt ?? null);
    }

    const { at: scannedAt, adjusted } = clampScanTime(event, new Date(item.scannedAt), receivedAt);
    const attempt = (
      outcome: (typeof checkInAttempts.$inferInsert)["outcome"],
      attendeeId: string | null,
      extra: Partial<typeof checkInAttempts.$inferInsert> = {},
    ) =>
      tx.insert(checkInAttempts).values({
        eventId: event.id,
        organizationId: event.organizationId,
        attendeeId,
        scannedBy: user.id,
        clientCheckInId: item.clientCheckInId,
        deviceId,
        method: item.method,
        outcome,
        scannedAt,
        receivedAt,
        ...extra,
      });

    if (event.status === "draft") {
      await attempt("outside_window", null);
      return result("rejected", "outside_window", null);
    }
    const credential = await validateCredential(tx, event, item);
    if (!credential.ok) {
      // The device accepted it with older data (e.g. revoked meanwhile): report, do not count.
      await attempt(credential.outcome, credential.attendeeId);
      return result("rejected", credential.outcome, null);
    }

    const values = {
      eventId: event.id,
      attendeeId: credential.attendeeId,
      organizationId: event.organizationId,
      ticketId: credential.ticketId,
      scannedBy: user.id,
      clientCheckInId: item.clientCheckInId,
      deviceId,
      method: item.method,
      mode: "offline" as const,
      scannedAt,
      receivedAt,
      clockAdjusted: adjusted,
    };
    const [inserted] = await tx.insert(checkIns).values(values).onConflictDoNothing().returning();
    if (inserted) {
      await attempt("valid", credential.attendeeId);
      return result("accepted", null, inserted.scannedAt);
    }

    // Conflict: the attendee was already checked in. The earliest scan wins (ADR-0005).
    const [existing] = await tx
      .select()
      .from(checkIns)
      .where(and(eq(checkIns.eventId, event.id), eq(checkIns.attendeeId, credential.attendeeId)))
      .for("update");
    if (!existing) throw new Error("Check-in conflict without an existing row");
    if (scannedAt < existing.scannedAt) {
      // The stored check-in becomes the duplicate; keep its own scanner, device and time.
      await tx.insert(checkInAttempts).values({
        eventId: event.id,
        organizationId: event.organizationId,
        attendeeId: existing.attendeeId,
        scannedBy: existing.scannedBy,
        clientCheckInId: existing.clientCheckInId,
        deviceId: existing.deviceId,
        method: existing.method,
        outcome: "duplicate_offline",
        scannedAt: existing.scannedAt,
        receivedAt: existing.receivedAt,
      });
      const [replaced] = await tx
        .update(checkIns)
        .set(values)
        .where(eq(checkIns.id, existing.id))
        .returning();
      await attempt("valid", credential.attendeeId);
      return result("accepted", null, replaced!.scannedAt);
    }
    await attempt("duplicate_offline", credential.attendeeId);
    return result("duplicate", null, existing.scannedAt);
  });
}

/** Applies queued offline check-ins one by one (each in its own transaction). */
export async function syncCheckIns(
  deps: ServiceDeps,
  user: { id: string },
  eventId: string,
  request: SyncRequest,
): Promise<SyncResult> {
  const { event } = await findScannableEvent(deps.db, user.id, eventId);
  const results: ItemResult[] = [];
  for (const item of request.items) {
    results.push(await syncItem(deps, user, event, request.deviceId, item));
  }
  return { results, counts: await counts(deps.db, event.id) };
}
